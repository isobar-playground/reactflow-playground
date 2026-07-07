"use client";

import { useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createCanvasAction } from "@/app/canvas-actions";

export function NewCanvasButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      disabled={isPending}
      aria-busy={isPending}
      onClick={() => startTransition(() => createCanvasAction())}
    >
      <Plus aria-hidden="true" />
      New canvas
    </Button>
  );
}
