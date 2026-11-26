import { useEffect, useRef, useState, type PointerEvent } from "react";
import { GripVertical } from "lucide-react";
import type { JsonMap } from "../api/types";
import { profileText, stepSummary } from "../lib/profileEditor";

type Drag = {
  pointerId: number;
  list: HTMLDivElement;
  scrollArea: HTMLElement;
  horizontal: boolean;
  from: number;
  to: number;
  start: number;
  center: number;
  position: number;
  moved: boolean;
  frame: number;
};

function centerOf(bounds: DOMRect, horizontal: boolean) {
  return horizontal ? bounds.left + bounds.width / 2 : bounds.top + bounds.height / 2;
}

export function ProfileStepList({ steps, selected, disabled, onSelect, onReorder }: {
  steps: JsonMap[];
  selected: number;
  disabled: boolean;
  onSelect: (index: number) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<{ from: number; to: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => () => cancelAnimationFrame(dragRef.current?.frame ?? 0), []);

  function updateDestination(drag: Drag) {
    const center = drag.center + drag.position - drag.start;
    let to = 0;
    Array.from(drag.list.children).forEach((card, index) => {
      if (index !== drag.from && center >= centerOf(card.getBoundingClientRect(), drag.horizontal)) to += 1;
    });
    if (!drag.moved || to !== drag.to) setPreview({ from: drag.from, to });
    drag.to = to;
    drag.moved = true;
  }

  function scrollNearEdge() {
    const drag = dragRef.current;
    if (!drag) return;
    drag.frame = 0;
    const area = drag.scrollArea;
    const bounds = area.getBoundingClientRect();
    const low = drag.horizontal ? bounds.left : bounds.top;
    const high = drag.horizontal ? bounds.right : bounds.bottom;
    const threshold = 36;
    const speed = drag.position < low + threshold ? -Math.min(16, (low + threshold - drag.position) / 3)
      : drag.position > high - threshold ? Math.min(16, (drag.position - high + threshold) / 3) : 0;
    if (!speed) return;

    const before = drag.horizontal ? area.scrollLeft : area.scrollTop;
    if (drag.horizontal) area.scrollLeft += speed;
    else area.scrollTop += speed;
    if (before === (drag.horizontal ? area.scrollLeft : area.scrollTop)) return;
    updateDestination(drag);
    drag.frame = requestAnimationFrame(scrollNearEdge);
  }

  function reorder(from: number, to: number, restoreFocus = false) {
    if (disabled || from === to || !steps[from] || !steps[to]) return;
    onReorder(from, to);
    setAnnouncement(`${profileText(steps[from].name) || "Step"} moved to position ${to + 1} of ${steps.length}.`);
    if (restoreFocus) listRef.current?.children[to]?.querySelector<HTMLElement>(".recipe-step-grip")?.focus();
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, index: number) {
    const list = listRef.current;
    if (!list || disabled || event.button !== 0 || !event.isPrimary || dragRef.current) return;
    const horizontal = getComputedStyle(list).gridAutoFlow === "column";
    const position = horizontal ? event.clientX : event.clientY;
    const scrollArea = horizontal ? list : list.closest<HTMLElement>(".recipe-body") ?? list;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId, list, scrollArea, horizontal, from: index, to: index,
      start: position, center: centerOf(list.children[index].getBoundingClientRect(), horizontal),
      position, moved: false, frame: 0
    };
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || disabled) return;
    drag.position = drag.horizontal ? event.clientX : event.clientY;
    if (!drag.moved && Math.abs(drag.position - drag.start) < 6) return;
    updateDestination(drag);
    if (!drag.frame) drag.frame = requestAnimationFrame(scrollNearEdge);
  }

  function finishDrag(event?: PointerEvent<HTMLButtonElement>, commit = false) {
    const drag = dragRef.current;
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    if (commit && event) moveDrag(event);
    dragRef.current = null;
    cancelAnimationFrame(drag.frame);
    setPreview(null);
    if (commit && drag.moved) reorder(drag.from, drag.to, document.activeElement === event?.currentTarget);
  }

  return <>
    <div ref={listRef} className="recipe-step-buttons">
      {steps.map((step, index) => {
        const name = profileText(step.name) || "Untitled step";
        const drop = preview?.to === index && preview.from !== index ? index < preview.from ? "before" : "after" : undefined;
        return <div key={index} className="recipe-step-card" data-selected={index === selected || undefined}
          data-dragging={preview?.from === index || undefined} data-drop={drop}>
          {steps.length > 1 && <button type="button" className="recipe-step-grip" disabled={disabled}
            aria-label={`Reorder step ${index + 1}, ${name}`} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
            title="Drag or use the arrow keys to reorder"
            onPointerDown={(event) => startDrag(event, index)}
            onPointerMove={moveDrag}
            onPointerUp={(event) => finishDrag(event, true)}
            onPointerCancel={(event) => finishDrag(event)}
            onLostPointerCapture={(event) => finishDrag(event)}
            onClick={(event) => { if (event.detail === 0) onSelect(index); }}
            onKeyDown={(event) => {
              if (dragRef.current) {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  finishDrag();
                }
                return;
              }
              const earlier = event.key === "ArrowUp" || event.key === "ArrowLeft";
              if (!earlier && event.key !== "ArrowDown" && event.key !== "ArrowRight") return;
              event.preventDefault();
              reorder(index, index + (earlier ? -1 : 1), true);
            }}>
            <GripVertical aria-hidden="true" size={19} />
          </button>}
          <button type="button" className="recipe-step-choice" aria-pressed={index === selected} disabled={disabled} onClick={() => onSelect(index)}>
            <span>{index + 1}</span>
            <div><strong>{name}</strong><small>{stepSummary(step)}</small></div>
          </button>
        </div>;
      })}
    </div>
    <span className="recipe-step-status" role="status">{announcement}</span>
  </>;
}
