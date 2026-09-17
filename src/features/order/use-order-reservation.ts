"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "editing" | "submitting" | "expired" | "leaving";

// Keep reservation renewal running during uploads, but never let it navigate
// away from an in-flight order. Only the explicit leave button releases a seat.
export function useOrderReservation(hardExpiresAt: string, serverNow: string) {
  const [now, setNow] = useState(() => Date.parse(serverNow));
  const [idleWarning, setIdleWarning] = useState(false);
  const [reservationError, setReservationError] = useState("");
  const [expired, setExpired] = useState(false);
  const phase = useRef<Phase>("editing");
  const generation = useRef(0);
  const activityAt = useRef(Date.now());
  const clockOffset = useRef(Date.parse(serverNow) - Date.now());

  const markActivity = useCallback(() => {
    activityAt.current = Date.now();
    setIdleWarning(false);
  }, []);

  const beginSubmission = useCallback(() => {
    if (phase.current !== "editing") return false;
    phase.current = "submitting";
    generation.current += 1;
    markActivity();
    setReservationError("");
    return true;
  }, [markActivity]);

  const submissionFailed = useCallback(() => {
    phase.current = "editing";
    generation.current += 1;
    markActivity();
  }, [markActivity]);

  const releaseAndLeave = useCallback(async (message: string) => {
    if (phase.current === "submitting" || phase.current === "leaving") return;
    phase.current = "leaving";
    generation.current += 1;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      await fetch("/api/reservations/release", {
        method: "POST",
        keepalive: true,
        signal: controller.signal,
      });
    } catch {
      // If the release request fails, the server lease still expires naturally.
    } finally {
      window.clearTimeout(timeout);
    }
    window.alert(message);
    window.location.assign("/");
  }, []);

  useEffect(() => {
    let disposed = false;
    let pending: AbortController | null = null;
    const expire = (message: string) => {
      if (phase.current !== "editing") return;
      phase.current = "expired";
      setExpired(true);
      setIdleWarning(false);
      setReservationError(message);
    };
    const renew = async () => {
      if (disposed || pending || !["editing", "submitting"].includes(phase.current)) return;
      if (phase.current === "editing" && Date.now() - activityAt.current >= 5 * 60_000) return;
      const requestGeneration = generation.current;
      const controller = new AbortController();
      pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch("/api/reservations/heartbeat", {
          method: "POST",
          signal: controller.signal,
        });
        const payload = await response.json();
        // A response started before/during submission must not expire the form
        // after submission starts or after a failed submission allows a retry.
        if (disposed || generation.current !== requestGeneration || phase.current !== "editing") return;
        if (response.status === 410 && payload?.error?.code === "RESERVATION_EXPIRED") {
          expire("주문 자리가 만료되었어요. 입력 내용은 화면에 남아 있습니다. 다시 주문하려면 나간 뒤 재입장해주세요.");
        } else if (!response.ok) {
          setReservationError("주문 자리 확인이 지연되고 있어요. 연결을 확인해주세요. 자동으로 다시 확인합니다.");
        } else {
          setReservationError("");
        }
      } catch {
        if (!disposed && generation.current === requestGeneration && phase.current === "editing") {
          setReservationError("주문 자리 확인이 지연되고 있어요. 연결을 확인해주세요. 자동으로 다시 확인합니다.");
        }
      } finally {
        window.clearTimeout(timeout);
        pending = null;
      }
    };
    const timer = window.setInterval(() => {
      const current = Date.now() + clockOffset.current;
      setNow(current);
      if (phase.current !== "editing") return;
      const idle = Date.now() - activityAt.current;
      if (current >= Date.parse(hardExpiresAt)) {
        expire("30분의 주문서 작성 시간이 끝났어요. 다시 주문하려면 나간 뒤 재입장해주세요.");
      } else if (idle >= 6 * 60_000) {
        expire("오랫동안 활동이 없어 주문 자리가 만료되었어요. 다시 주문하려면 나간 뒤 재입장해주세요.");
      } else {
        setIdleWarning(idle >= 5 * 60_000);
      }
    }, 1_000);
    const heartbeat = window.setInterval(() => void renew(), 30_000);
    const onResume = () => {
      if (document.visibilityState === "visible") void renew();
    };
    const onOnline = () => void renew();
    const events = ["pointerdown", "keydown", "input"] as const;
    events.forEach((event) => window.addEventListener(event, markActivity, { passive: true }));
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("online", onOnline);
    // No pagehide release: reloads and mobile page transitions are not consent
    // to abandon the order. Abandoned seats use the existing 90-second lease.
    return () => {
      disposed = true;
      pending?.abort();
      window.clearInterval(timer);
      window.clearInterval(heartbeat);
      events.forEach((event) => window.removeEventListener(event, markActivity));
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("online", onOnline);
    };
  }, [hardExpiresAt, markActivity]);

  return { now, idleWarning, reservationError, expired, markActivity, beginSubmission, submissionFailed, releaseAndLeave };
}
