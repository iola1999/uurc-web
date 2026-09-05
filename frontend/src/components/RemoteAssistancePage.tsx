import { TerminalSquare } from "lucide-react";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";

import { RemoteAssistanceCard } from "./RemoteAssistanceCard.js";

export function RemoteAssistancePage({
  busy,
  connectCode,
  connectId,
  error,
  notice,
  onConnectCodeChange,
  onConnectIdChange,
  onStart,
}: {
  busy: string | null;
  connectCode: string;
  connectId: string;
  error: string;
  notice: string;
  onConnectCodeChange: (value: string) => void;
  onConnectIdChange: (value: string) => void;
  onStart: () => void;
}) {
  const [searchParams] = useSearchParams();
  const appliedPrefill = useRef<string | null>(null);

  useEffect(() => {
    const prefillId = searchParams.get("id");
    if (appliedPrefill.current === prefillId) return;
    if (prefillId) onConnectIdChange(prefillId.replace(/\D/g, ""));
    appliedPrefill.current = prefillId;
  }, [searchParams, onConnectIdChange]);

  return (
    <>
      <header className="shell-page-topbar">
        <h1>远控伙伴</h1>
      </header>
      <div className="shell-page-body">
        <div className="shell-page-body-narrow">
          {error ? (
            <section className="error-strip" role="alert" aria-live="assertive">
              <TerminalSquare size={18} />
              <span>{error}</span>
            </section>
          ) : null}
          <RemoteAssistanceCard
            busy={busy}
            connectCode={connectCode}
            connectId={connectId}
            notice={notice}
            onConnectCodeChange={onConnectCodeChange}
            onConnectIdChange={onConnectIdChange}
            onStart={onStart}
          />
        </div>
      </div>
    </>
  );
}
