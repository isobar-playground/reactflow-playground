import Link from "next/link";
import { listAssets } from "@/lib/asset-library";
import { AssetLibraryBrowser } from "@/components/asset-library-browser";
import { SURFACE_CLASSES } from "@/lib/visual-system";

// Asset Library is live, shared data — never prerender/cache it statically.
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const assets = await listAssets();

  return (
    <main className={`studio-shell min-h-screen w-full ${SURFACE_CLASSES.app}`}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-[var(--studio-control-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]">
            &larr; All canvases
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">Asset Library</h1>
        </div>
      </div>
      <AssetLibraryBrowser assets={assets} />
      </div>
    </main>
  );
}
