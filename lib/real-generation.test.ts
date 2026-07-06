import { describe, it, expect, vi, afterEach } from "vitest";
import * as generationActions from "@/app/generation-actions";
import {
  runImageGeneration,
  resumeImageGeneration,
  runVideoGeneration,
  resumeVideoGeneration,
  submitImageGeneration,
} from "./real-generation";
import type { MediaHandleConnection } from "./generation-payload";
import type { ResolvedHandle } from "./fal-schema";

// real-generation: the node-facing call that submits via the queue-API
// server action and polls the status action until FAL is done. Shared
// submit/poll internals back both the Image and Video Generation Node's
// functions (issue #39 / ADR-0009's "one transport for both node kinds").

describe("runImageGeneration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const pending = {
    requestId: "req-1",
    statusUrl: "https://queue.fal.run/x/status",
    responseUrl: "https://queue.fal.run/x",
  };

  it("submits the prompt (and negative_prompt when given) and resolves to the image once completed", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "completed",
      mediaUrl: "https://fal.media/out.png",
    });

    const result = await runImageGeneration({
      endpointId: "fal-ai/flux/schnell",
      prompt: "a red car",
      negativePrompt: "blurry",
    });

    expect(generationActions.submitGenerationAction).toHaveBeenCalledWith("fal-ai/flux/schnell", {
      prompt: "a red car",
      negative_prompt: "blurry",
    });
    expect(result).toEqual({ kind: "image", url: "https://fal.media/out.png" });
  });

  it("omits negative_prompt from the request body when not given", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "completed",
      mediaUrl: "https://fal.media/out.png",
    });

    await runImageGeneration({ endpointId: "fal-ai/flux/schnell", prompt: "a red car" });

    expect(generationActions.submitGenerationAction).toHaveBeenCalledWith("fal-ai/flux/schnell", {
      prompt: "a red car",
    });
  });

  it("calls onPending with the submitted record before polling", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "completed",
      mediaUrl: "https://fal.media/out.png",
    });
    const onPending = vi.fn();

    await runImageGeneration(
      { endpointId: "fal-ai/flux/schnell", prompt: "a red car" },
      { onPending },
    );

    expect(onPending).toHaveBeenCalledWith(pending);
  });

  it("polls again (via the injectable wait) while the status is pending, then resolves", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    const poll = vi
      .spyOn(generationActions, "pollGenerationAction")
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "completed", mediaUrl: "https://fal.media/out.png" });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await runImageGeneration(
      { endpointId: "fal-ai/flux/schnell", prompt: "a red car" },
      { wait, pollIntervalMs: 1234 },
    );

    expect(poll).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1234);
    expect(result).toEqual({ kind: "image", url: "https://fal.media/out.png" });
  });

  it("throws with the FAL error message when the poll reports an error", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "error",
      message: "moderation blocked the request",
    });

    await expect(
      runImageGeneration({ endpointId: "fal-ai/flux/schnell", prompt: "a red car" }),
    ).rejects.toThrow("moderation blocked the request");
  });

  // Actual Cost (CONTEXT.md / ADR-0009, issue #41): the billable-units count
  // the poll action forwards rides along on the resolved result so the node
  // component can compute the Actual Cost from it and the Model's
  // snapshotted unit price.
  it("resolves with the billableUnits the poll action reports alongside the output", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "completed",
      mediaUrl: "https://fal.media/out.png",
      billableUnits: 2,
    });

    const result = await runImageGeneration({ endpointId: "fal-ai/flux/schnell", prompt: "a red car" });

    expect(result).toEqual({ kind: "image", url: "https://fal.media/out.png", billableUnits: 2 });
  });

  // Connected media inputs (issue #40 / ADR-0009): the node's snapshotted
  // Model handles + their currently-connected source nodes (lib/generation-payload.ts)
  // are folded into the submitted body, and any local Asset Library asset is
  // forwarded as a localAssetRef for the submit action to inline.
  it("folds connected media handles into the submitted body and forwards local asset refs", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "completed",
      mediaUrl: "https://fal.media/out.png",
    });

    const imageUrlHandle: ResolvedHandle = {
      handleId: "image_url",
      label: "image_url",
      dataType: "image",
      many: false,
    };
    const media: MediaHandleConnection[] = [
      {
        handle: imageUrlHandle,
        sources: [{ type: "staticMediaReference", data: { asset: { url: "/uploads/cat.png", type: "image" } } }],
      },
    ];

    await runImageGeneration({ endpointId: "fal-ai/flux/schnell", prompt: "a red car", media });

    expect(generationActions.submitGenerationAction).toHaveBeenCalledWith(
      "fal-ai/flux/schnell",
      { prompt: "a red car", image_url: "/uploads/cat.png" },
      [{ handleId: "image_url", url: "/uploads/cat.png" }],
    );
  });
});

// submitImageGeneration (issue #48 / ADR-0011): the submit-only operation a
// variant submitter uses for its clones — submits to the FAL queue and
// resolves to the pending-generation record without ever polling. Polling
// (and the History append it ends in) belongs to the clone node that owns
// the run, via its resume-on-mount machinery.
describe("submitImageGeneration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const pending = {
    requestId: "req-1",
    statusUrl: "https://queue.fal.run/x/status",
    responseUrl: "https://queue.fal.run/x",
  };

  it("submits the prompt (and negative_prompt when given) and resolves to the pending record without polling", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    const poll = vi.spyOn(generationActions, "pollGenerationAction");

    const result = await submitImageGeneration({
      endpointId: "fal-ai/flux/schnell",
      prompt: "a red car",
      negativePrompt: "blurry",
    });

    expect(generationActions.submitGenerationAction).toHaveBeenCalledWith("fal-ai/flux/schnell", {
      prompt: "a red car",
      negative_prompt: "blurry",
    });
    expect(result).toEqual(pending);
    expect(poll).not.toHaveBeenCalled();
  });

  it("folds connected media handles into the submitted body and forwards local asset refs, like a full run", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    const poll = vi.spyOn(generationActions, "pollGenerationAction");

    const imageUrlHandle: ResolvedHandle = {
      handleId: "image_url",
      label: "image_url",
      dataType: "image",
      many: false,
    };
    const media: MediaHandleConnection[] = [
      {
        handle: imageUrlHandle,
        sources: [{ type: "staticMediaReference", data: { asset: { url: "/uploads/cat.png", type: "image" } } }],
      },
    ];

    const result = await submitImageGeneration({
      endpointId: "fal-ai/flux/schnell",
      prompt: "a red car",
      media,
    });

    expect(generationActions.submitGenerationAction).toHaveBeenCalledWith(
      "fal-ai/flux/schnell",
      { prompt: "a red car", image_url: "/uploads/cat.png" },
      [{ handleId: "image_url", url: "/uploads/cat.png" }],
    );
    expect(result).toEqual(pending);
    expect(poll).not.toHaveBeenCalled();
  });
});

// resumeImageGeneration (issue #38): resumes polling an already-submitted
// pending record — e.g. one restored from node data after a page reload —
// without re-submitting to FAL. Shares the same poll-until-settled loop as
// runImageGeneration, just entered with a record instead of a fresh submit.
describe("resumeImageGeneration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const pending = {
    requestId: "req-1",
    statusUrl: "https://queue.fal.run/x/status",
    responseUrl: "https://queue.fal.run/x",
  };

  it("polls the given pending record without submitting a new request, and resolves once completed", async () => {
    const submit = vi.spyOn(generationActions, "submitGenerationAction");
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "completed",
      mediaUrl: "https://fal.media/out.png",
    });

    const result = await resumeImageGeneration(pending);

    expect(submit).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "image", url: "https://fal.media/out.png" });
  });

  it("keeps polling (via the injectable wait) while still pending, then resolves", async () => {
    const poll = vi
      .spyOn(generationActions, "pollGenerationAction")
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "completed", mediaUrl: "https://fal.media/out.png" });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await resumeImageGeneration(pending, { wait, pollIntervalMs: 500 });

    expect(poll).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(500);
    expect(result).toEqual({ kind: "image", url: "https://fal.media/out.png" });
  });

  it("throws when FAL no longer recognizes the resumed request (stale record)", async () => {
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "error",
      message: "FAL queue status returned 404",
    });

    await expect(resumeImageGeneration(pending)).rejects.toThrow("FAL queue status returned 404");
  });
});

// Video Generation Node's real generation (issue #39): identical submit/poll
// mechanics to the image path above, just resolving to a `{kind: "video"}`
// placeholder — proves the shared pollUntilSettled loop tags the right kind
// rather than assuming image.
describe("runVideoGeneration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const pending = {
    requestId: "req-1",
    statusUrl: "https://queue.fal.run/x/status",
    responseUrl: "https://queue.fal.run/x",
  };

  it("submits the prompt (and negative_prompt when given) and resolves to the video once completed", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "completed",
      mediaUrl: "https://fal.media/clip.mp4",
    });

    const result = await runVideoGeneration({
      endpointId: "fal-ai/kling-video/v3/pro/image-to-video",
      prompt: "a car driving fast",
      negativePrompt: "blurry",
    });

    expect(generationActions.submitGenerationAction).toHaveBeenCalledWith(
      "fal-ai/kling-video/v3/pro/image-to-video",
      { prompt: "a car driving fast", negative_prompt: "blurry" },
    );
    expect(result).toEqual({ kind: "video", url: "https://fal.media/clip.mp4" });
  });

  it("omits negative_prompt from the request body when not given", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "completed",
      mediaUrl: "https://fal.media/clip.mp4",
    });

    await runVideoGeneration({ endpointId: "fal-ai/veo/text-to-video", prompt: "a car driving fast" });

    expect(generationActions.submitGenerationAction).toHaveBeenCalledWith("fal-ai/veo/text-to-video", {
      prompt: "a car driving fast",
    });
  });

  it("calls onPending with the submitted record before polling", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "completed",
      mediaUrl: "https://fal.media/clip.mp4",
    });
    const onPending = vi.fn();

    await runVideoGeneration(
      { endpointId: "fal-ai/veo/text-to-video", prompt: "a car driving fast" },
      { onPending },
    );

    expect(onPending).toHaveBeenCalledWith(pending);
  });

  it("polls again (via the injectable wait) while the status is pending, then resolves", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    const poll = vi
      .spyOn(generationActions, "pollGenerationAction")
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "completed", mediaUrl: "https://fal.media/clip.mp4" });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await runVideoGeneration(
      { endpointId: "fal-ai/veo/text-to-video", prompt: "a car driving fast" },
      { wait, pollIntervalMs: 1234 },
    );

    expect(poll).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1234);
    expect(result).toEqual({ kind: "video", url: "https://fal.media/clip.mp4" });
  });

  it("throws with the FAL error message when the poll reports an error", async () => {
    vi.spyOn(generationActions, "submitGenerationAction").mockResolvedValue(pending);
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "error",
      message: "moderation blocked the request",
    });

    await expect(
      runVideoGeneration({ endpointId: "fal-ai/veo/text-to-video", prompt: "a car driving fast" }),
    ).rejects.toThrow("moderation blocked the request");
  });
});

// resumeVideoGeneration (issue #38's treatment, extended to video by issue
// #39): resumes polling an already-submitted video pending record without
// re-submitting to FAL.
describe("resumeVideoGeneration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const pending = {
    requestId: "req-1",
    statusUrl: "https://queue.fal.run/x/status",
    responseUrl: "https://queue.fal.run/x",
  };

  it("polls the given pending record without submitting a new request, and resolves once completed", async () => {
    const submit = vi.spyOn(generationActions, "submitGenerationAction");
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "completed",
      mediaUrl: "https://fal.media/clip.mp4",
    });

    const result = await resumeVideoGeneration(pending);

    expect(submit).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "video", url: "https://fal.media/clip.mp4" });
  });

  it("keeps polling (via the injectable wait) while still pending, then resolves", async () => {
    const poll = vi
      .spyOn(generationActions, "pollGenerationAction")
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "completed", mediaUrl: "https://fal.media/clip.mp4" });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await resumeVideoGeneration(pending, { wait, pollIntervalMs: 500 });

    expect(poll).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(500);
    expect(result).toEqual({ kind: "video", url: "https://fal.media/clip.mp4" });
  });

  it("throws when FAL no longer recognizes the resumed request (stale record)", async () => {
    vi.spyOn(generationActions, "pollGenerationAction").mockResolvedValue({
      status: "error",
      message: "FAL queue status returned 404",
    });

    await expect(resumeVideoGeneration(pending)).rejects.toThrow("FAL queue status returned 404");
  });
});
