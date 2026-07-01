"use client";

import { ReactFlow, Background, Controls } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import type { Canvas } from "@/lib/canvas-repo";

export function CanvasEditor({ canvas }: { canvas: Canvas }) {
  return (
    <div className="flex h-screen w-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          &larr; All canvases
        </Link>
        <h1 className="text-sm font-medium">{canvas.name}</h1>
      </header>
      <div className="flex-1">
        <ReactFlow nodes={[]} edges={[]} fitView>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
