import Link from "next/link";
import { listCanvases } from "@/lib/canvas-repo";
import { CanvasList } from "@/components/canvas-list";
import { NewCanvasButton } from "@/components/new-canvas-button";

// Canvas list is live, shared data — never prerender/cache it statically.
export const dynamic = "force-dynamic";

export default async function Home() {
  const canvases = await listCanvases();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">React Flow Playground</h1>
        <div className="flex items-center gap-2">
          <Link href="/library" className="text-sm text-muted-foreground hover:underline">
            Asset Library
          </Link>
          <NewCanvasButton />
        </div>
      </div>
      <CanvasList canvases={canvases} />
    </main>
  );
}
