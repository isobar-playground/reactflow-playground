"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createCanvasAction } from "@/app/canvas-actions";

export function NewCanvasButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      disabled={isPending}
      onClick={() => startTransition(() => createCanvasAction())}
    >
      New canvas
    </Button>
  );
}
