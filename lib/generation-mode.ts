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
