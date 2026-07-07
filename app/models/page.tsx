import Link from "next/link";
import { listModels } from "@/lib/fal-models";
import { listApprovedEndpointIds } from "@/lib/model-approvals";
import { listEditPairs } from "@/lib/model-edit-pairs";
import { ModelsBrowser } from "@/components/models-browser";
import { SURFACE_CLASSES } from "@/lib/visual-system";

// The Model Catalog is read live from FAL (ADR-0006), never snapshotted —
// so never prerender/cache this statically.
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  // Approvals and the Edit Model pairing (ADR-0014, PRD #69) both live in our
  // DB (ADR-0006) and load independently of FAL, so they resolve even when
  // the catalog fetch below fails.
  const [approvedIds, editPairs] = await Promise.all([listApprovedEndpointIds(), listEditPairs()]);

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
    <main className={`studio-shell min-h-screen w-full ${SURFACE_CLASSES.app}`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 sm:p-8">
      <div>
        <Link href="/" className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-[var(--studio-control-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]">
          &larr; All canvases
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">Models</h1>
      </div>

      {failed ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t load the model catalog from FAL. Please try again later.
        </p>
      ) : (
        <ModelsBrowser models={models ?? []} approvedIds={approvedIds} editPairs={editPairs} />
      )}
      </div>
    </main>
  );
}
