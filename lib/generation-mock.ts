// Mocked generation (CONTEXT.md / PRD): a short delay then a placeholder
// result, so the flow feels like real async generation without calling any
// real model. Images come from picsum.photos with a random seed.

const GENERATION_DELAY_MS = 2000;
const PLACEHOLDER_WIDTH = 768;
const PLACEHOLDER_HEIGHT = 768;

export interface ImagePlaceholderResult {
  kind: "image";
  url: string;
}

export interface VideoPlaceholderResult {
  kind: "video";
  url: string;
}

// Video Generation Node's mocked output (issue #11): a single bundled
// looping sample mp4 served from /public — there's no per-generation
// variation like picsum's random seed, since it's just a stand-in clip.
const SAMPLE_VIDEO_URL = "/sample-video.mp4";

function randomSeed(): string {
  return Math.random().toString(36).slice(2);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolves after a short delay to an image placeholder from picsum.photos
// using a random seed, per CONTEXT.md's `generation-mock` module.
export async function generateImagePlaceholder(): Promise<ImagePlaceholderResult> {
  await wait(GENERATION_DELAY_MS);
  return {
    kind: "image",
    url: `https://picsum.photos/seed/${randomSeed()}/${PLACEHOLDER_WIDTH}/${PLACEHOLDER_HEIGHT}`,
  };
}

// Resolves after a short delay to the bundled looping sample mp4 (issue
// #11's Video Generation Node placeholder output).
export async function generateVideoPlaceholder(): Promise<VideoPlaceholderResult> {
  await wait(GENERATION_DELAY_MS);
  return {
    kind: "video",
    url: SAMPLE_VIDEO_URL,
  };
}
