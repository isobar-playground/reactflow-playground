"use server";

import { revalidatePath } from "next/cache";
import { uploadAsset, listAssets } from "@/lib/asset-library";

export async function uploadAssetAction(file: File) {
  const asset = await uploadAsset(file);
  revalidatePath("/library");
  return asset;
}

export async function listAssetsAction() {
  return listAssets();
}
