import Link from "next/link";
import { listModels } from "@/lib/fal-models";
import { ModelsBrowser } from "@/components/models-browser";

// The Model Catalog is read live from FAL (ADR-0006), never snapshotted —
// so never prerender/cache this statically.
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  let models = null;
  let failed = false;
  try {
    models = await listModels();
  } catch {
    // FAL unreachable: render an error state rather than crashing (ADR-0006
    // Consequences). Approvals still exist in our DB; there's just nothing to
    // join them against until FAL responds.
    failed = true;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          &larr; All canvases
        </Link>
        <h1 className="text-xl font-semibold">Models</h1>
      </div>

      {failed ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t load the model catalog from FAL. Please try again later.
        </p>
      ) : (
        <ModelsBrowser models={models ?? []} />
      )}
    </main>
  );
}
