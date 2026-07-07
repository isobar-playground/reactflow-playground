import { Handle, Position, type HandleType } from "@xyflow/react";
import { Image as ImageIcon, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataType } from "@/lib/connection-rules";
import { DATA_TYPE_TREATMENTS } from "@/lib/visual-system";

// HandleBadge (CONTEXT.md / PRD issue #17): every node's connection points
// were a near-invisible, unlabeled dot in the theme's default color. This
// wraps React Flow's Handle in a larger circle (roughly 16-20px, up from the
// default ~6px) around a centered glyph naming its data type — literal "T"
// for text, an image icon for image, a video icon for video — applied
// consistently to both input and output handles across all four node types.
// The data-type distinction uses both the shared semantic color treatment
// and a visible glyph/title, so color is never the only cue.
export function HandleBadge({
  type,
  position,
  dataType,
  id,
  title,
  style,
}: {
  type: HandleType;
  position: Position;
  dataType: DataType;
  id?: string;
  title?: string;
  style?: React.CSSProperties;
}) {
  const treatment = DATA_TYPE_TREATMENTS[dataType];
  return (
    <Handle
      type={type}
      position={position}
      id={id}
      style={style}
      title={title ?? treatment.label}
      aria-label={`${treatment.label} ${type} handle`}
    >
      <div
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[10px] font-semibold shadow-sm ring-2 ring-white",
          treatment.classes,
        )}
      >
        <DataTypeGlyph dataType={dataType} />
      </div>
    </Handle>
  );
}

function DataTypeGlyph({ dataType }: { dataType: DataType }) {
  switch (dataType) {
    case "text":
      return <span aria-hidden="true">T</span>;
    case "image":
      return <ImageIcon aria-hidden="true" className="h-3 w-3" />;
    case "video":
      return <Video aria-hidden="true" className="h-3 w-3" />;
  }
}
