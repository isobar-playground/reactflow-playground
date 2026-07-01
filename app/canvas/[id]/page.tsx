import { notFound } from "next/navigation";
import { getCanvas } from "@/lib/canvas-repo";
import { CanvasEditor } from "@/components/canvas-editor";

export default async function CanvasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const canvas = await getCanvas(id);
  if (!canvas) notFound();

  return <CanvasEditor canvas={canvas} />;
}
