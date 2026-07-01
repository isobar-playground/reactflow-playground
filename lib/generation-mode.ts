// generation-mode (CONTEXT.md / issue #10): a Generation Node's mode is
// derived from which inputs are connected, never chosen by hand — the node
// displays the resulting label. Image Gen: text only -> text->image; any
// image present -> image->image (edit).

export type ImageGenerationMode = "text-to-image" | "image-to-image";

export function imageGenerationMode(hasConnectedImage: boolean): ImageGenerationMode {
  return hasConnectedImage ? "image-to-image" : "text-to-image";
}

const IMAGE_GENERATION_MODE_LABELS: Record<ImageGenerationMode, string> = {
  "text-to-image": "Text → Image",
  "image-to-image": "Image → Image (Edit)",
};

export function imageGenerationModeLabel(mode: ImageGenerationMode): string {
  return IMAGE_GENERATION_MODE_LABELS[mode];
}

// Video Gen (CONTEXT.md / issue #11): text only -> text->video; frames or
// image references present -> image->video; a video present -> video->video
// (video takes priority since connecting one blocks the frame/image-ref
// handles at the connection-rules level — CONTEXT.md's video-exclusivity).
export type VideoGenerationMode = "text-to-video" | "image-to-video" | "video-to-video";

export function videoGenerationMode(input: {
  hasImageInput: boolean;
  hasVideo: boolean;
}): VideoGenerationMode {
  if (input.hasVideo) return "video-to-video";
  if (input.hasImageInput) return "image-to-video";
  return "text-to-video";
}

const VIDEO_GENERATION_MODE_LABELS: Record<VideoGenerationMode, string> = {
  "text-to-video": "Text → Video",
  "image-to-video": "Image → Video",
  "video-to-video": "Video → Video",
};

export function videoGenerationModeLabel(mode: VideoGenerationMode): string {
  return VIDEO_GENERATION_MODE_LABELS[mode];
}
