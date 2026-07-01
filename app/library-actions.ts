"use server";

import { revalidatePath } from "next/cache";
import { uploadAsset } from "@/lib/asset-library";

export async function uploadAssetAction(file: File) {
  await uploadAsset(file);
  revalidatePath("/library");
}
