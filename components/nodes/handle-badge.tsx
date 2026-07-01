import { Handle, Position, type HandleType } from "@xyflow/react";
import { Image as ImageIcon, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataType } from "@/lib/connection-rules";

// HandleBadge (CONTEXT.md / PRD issue #17): every node's connection points
// were a near-invisible, unlabeled dot in the theme's default color. This
// wraps React Flow's Handle in a larger circle (roughly 16-20px, up from the
// default ~6px) around a centered glyph naming its data type — literal "T"
// for text, an image icon for image, a video icon for video — applied
// consistently to both input and output handles across all four node types.
// Background/border stays neutral (existing border-border/bg-* tokens): the
// glyph, not color, carries the data-type distinction, matching the app's
// monochrome UI (per PRD "Out of scope": no color-coding).
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
  return (
    <Handle type={type} position={position} id={id} style={style} title={title}>
      <div
        className={cn(
          "pointer-events-none flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-foreground",
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
