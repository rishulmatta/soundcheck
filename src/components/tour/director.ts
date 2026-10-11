/**
 * The glue between the sequencer and the map. A plain class on purpose: it owns mutable state that must not
 * trigger React renders (hold reasons, the map handle, the clock) and talks to React only through two callbacks.
 *
 *   sequencer cues   -> map camera, route, bloom (imperative, no renders)
 *   sequencer phases -> onView (a handful of renders per stop: card in/out, header)
 *   sequencer status -> onStatus
 */
import type { PlanMapController } from "@/components/map/PlanMap";
import { clamp01, easeInOut } from "@/lib/tour/ease";
import {
  buildTimeline,
  createTourController,
  type CueEvent,
  type PhaseEvent,
  type TickEvent,
  type TourController,
  type TourStatus,
} from "@/lib/tour/sequencer";
import type { Plan } from "@/lib/types";
import type { CardPhase } from "./TourCard";

export interface ViewState {
  /** Stop the header and ring are on; equals the stop count in the finale. */
  index: number;
  finale: boolean;
  /** Which stop's content the card holds (the previous stop's while it fades out). */
  cardStop: number;
  cardPhase: CardPhase;
}

export const INITIAL_VIEW: ViewState = { index: 0, finale: false, cardStop: 0, cardPhase: "hidden" };

const CARD_PHASE: Record<string, CardPhase> = {
  leave: "hidden",
  travel: "hidden",
  land: "hidden",
  card: "card",
  detail: "detail",
  hold: "hold",
  fit: "hidden",
  summary: "card",
};

export interface MapSlot {
  current: PlanMapController | null;
}

export class TourDirector {
  readonly controller: TourController;
  private ready = false;
  /** Reasons the clock may be held. The tour runs only when none apply. */
  private hold = { user: false, hover: false, drag: false, hidden: false };
  private readonly stopCount: number;
  private readonly legDrawMs: number;

  constructor(
    plan: Plan,
    private readonly reducedMotion: boolean,
    private readonly slot: MapSlot,
    hooks: { onView: (v: ViewState) => void; onStatus: (s: TourStatus) => void },
  ) {
    const timeline = buildTimeline(plan, { reducedMotion });
    this.stopCount = plan.stops.length;
    this.legDrawMs = timeline.stops[1]?.cues.find((c) => c.kind === "legDraw")?.durationMs ?? 1200;
    this.controller = createTourController({
      timeline,
      onStatus: hooks.onStatus,
      onPhase: (e) => {
        hooks.onView(this.viewFor(e));
        if (e.jump) this.resetMap(e);
      },
      onCue: (e) => this.cue(e),
      onTick: (e) => this.tick(e),
    });
  }

  private viewFor(e: PhaseEvent): ViewState {
    const leaving = e.phase === "leave" && !e.jump && e.index > 0;
    return {
      index: e.index,
      finale: e.finale,
      // While the previous stop's card fades out we keep showing it; on a jump we snap to the target.
      cardStop: leaving ? e.index - 1 : Math.min(e.index, this.stopCount - 1),
      cardPhase: leaving ? "out" : (CARD_PHASE[e.phase] ?? "hidden"),
    };
  }

  /** After a seek, put the map into the state that moment of the tour implies, without animating. */
  private resetMap(e: PhaseEvent) {
    const map = this.slot.current;
    if (!map) return;
    for (let i = 0; i < this.stopCount; i++) map.setBloom(i + 1, e.finale || i < e.index, { instant: true });
    map.setFinale(false);
    map.setRouteProgress(e.finale ? this.stopCount : e.index, 1);
  }

  private cue({ cue, order }: CueEvent) {
    const map = this.slot.current;
    if (!map) return;
    switch (cue.kind) {
      case "fly":
        map.flyToStop(order, { durationMs: cue.durationMs, instant: cue.instant });
        break;
      case "land":
        map.setBloom(order, true, { instant: cue.instant });
        break;
      case "drift":
        map.drift(cue.durationMs ?? 0);
        break;
      case "fitRoute":
        map.fitRoute({ durationMs: cue.durationMs, instant: cue.instant });
        map.setFinale(true);
        break;
      default:
        break; // card, bar and row cues are CSS, driven by the phase
    }
  }

  /** The leg into this stop draws over legDrawMs, eased, in step with the fly. */
  private tick(e: TickEvent) {
    if (e.finale || e.index === 0) return;
    const t = this.reducedMotion ? 1 : easeInOut(clamp01(e.localMs / this.legDrawMs));
    this.slot.current?.setRouteProgress(e.index + 1, t);
  }

  /** Run the clock iff nothing is holding it. */
  private sync() {
    const h = this.hold;
    const shouldRun = this.ready && !h.user && !h.hover && !h.drag && !h.hidden;
    if (shouldRun) {
      if (this.controller.status() !== "playing") this.controller.play();
    } else {
      this.slot.current?.stopDrift();
      this.controller.pause();
    }
  }

  /** Called when the view mounts. If the map is already up (director rebuilt), start straight away. */
  attach() {
    if (this.slot.current) this.setReady();
  }

  setReady() {
    this.ready = true;
    this.sync();
  }

  destroy() {
    this.controller.destroy();
  }

  toggle() {
    if (this.controller.status() === "ended") {
      this.hold.user = false;
      this.controller.restart();
      return;
    }
    this.hold.user = this.controller.status() === "playing";
    this.sync();
  }

  seek(index: number) {
    this.controller.seek(index);
    this.sync();
  }

  next() {
    this.controller.next();
    this.sync();
  }

  prev() {
    this.controller.prev();
    this.sync();
  }

  replay() {
    this.hold.user = false;
    this.controller.restart();
  }

  setHover(on: boolean) {
    this.hold.hover = on;
    this.sync();
  }

  setHidden(on: boolean) {
    this.hold.hidden = on;
    this.sync();
  }

  /** Drag pauses the sequence; on release the frame returns to where the sequence expects it, then carries on. */
  setDrag(on: boolean) {
    this.hold.drag = on;
    if (!on) {
      const st = this.controller.state();
      if (st.finale) this.slot.current?.fitRoute({ durationMs: 800 });
      else this.slot.current?.flyToStop(st.index + 1, { durationMs: 800 });
    }
    this.sync();
  }
}
