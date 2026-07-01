import Link from "next/link";
import { listAssets } from "@/lib/asset-library";
import { AssetLibraryBrowser } from "@/components/asset-library-browser";

// Asset Library is live, shared data — never prerender/cache it statically.
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const assets = await listAssets();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            &larr; All canvases
          </Link>
          <h1 className="text-xl font-semibold">Asset Library</h1>
        </div>
      </div>
      <AssetLibraryBrowser assets={assets} />
    </main>
  );
}
