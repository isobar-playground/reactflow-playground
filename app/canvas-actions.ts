"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createCanvas,
  renameCanvas,
  deleteCanvas,
} from "@/lib/canvas-repo";

export async function createCanvasAction() {
  const canvas = await createCanvas();
  redirect(`/canvas/${canvas.id}`);
}

export async function renameCanvasAction(id: string, name: string) {
  await renameCanvas(id, name);
  revalidatePath("/");
}

export async function deleteCanvasAction(id: string) {
  await deleteCanvas(id);
  revalidatePath("/");
}
