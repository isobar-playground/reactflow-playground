import { describe, it, expect, vi, afterEach } from "vitest";
import * as generationActions from "@/app/generation-actions";
import { runImageGeneration } from "./real-generation";

// real-generation: the node-facing call that submits via the queue-API
// server action and polls the status action until FAL is done.

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
      imageUrl: "https://fal.media/out.png",
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
      imageUrl: "https://fal.media/out.png",
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
      imageUrl: "https://fal.media/out.png",
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
      .mockResolvedValueOnce({ status: "completed", imageUrl: "https://fal.media/out.png" });
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
});
