import Link from "next/link";
import { listCanvases } from "@/lib/canvas-repo";
import { CanvasList } from "@/components/canvas-list";
import { NewCanvasButton } from "@/components/new-canvas-button";
import { SURFACE_CLASSES } from "@/lib/visual-system";

// Canvas list is live, shared data — never prerender/cache it statically.
export const dynamic = "force-dynamic";

export default async function Home() {
  const canvases = await listCanvases();

  return (
    <main className={`studio-shell min-h-screen w-full ${SURFACE_CLASSES.app}`}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-semibold tracking-normal">React Flow Playground</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/library" className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-[var(--studio-control-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]">
            Asset Library
          </Link>
          <Link href="/models" className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-[var(--studio-control-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]">
            Models
          </Link>
          <NewCanvasButton />
        </div>
      </div>
      <CanvasList canvases={canvases} />
      </div>
    </main>
  );
}
