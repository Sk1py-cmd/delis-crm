"use client";

import { useState } from "react";
import { BellOff, CheckCircle2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { postManage } from "@/shared/lib/manage";
import { useToast } from "@/shared/ui/Toast";

export function CustomerConsent({ customerId, initialConsent }: { customerId: number; initialConsent: boolean }) {
  const [consent, setConsent] = useState(initialConsent);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const updateConsent = async (next: boolean) => {
    setBusy(true);
    try {
      await postManage("setCustomerMarketingConsent", { id: customerId, marketingConsent: next });
      setConsent(next);
      toast(next ? "Согласие на маркетинговые сообщения зафиксировано" : "Маркетинговые сообщения отключены", "ok");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Не удалось обновить согласие", "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl p-3" style={{ background: "rgba(var(--table-row))", border: "1px solid rgba(var(--border))" }}>
      <div className="flex items-start gap-2">
        {consent ? <CheckCircle2 size={17} className="mt-0.5 text-green-500" /> : <BellOff size={17} className="mt-0.5 text-amber-500" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Маркетинговые сообщения</div>
          <p className="text-xs muted mt-1 leading-relaxed">
            {consent
              ? "Клиент подтвердил получение акций и автоматических предложений."
              : "Рассылки и маркетинговые сценарии для клиента отключены."}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        className="btn w-full justify-center mt-3 text-xs"
        onClick={() => void updateConsent(!consent)}
      >
        <ShieldCheck size={14} />
        {busy ? "Сохраняем…" : consent ? "Отозвать согласие" : "Подтвердить согласие клиента"}
      </button>
    </div>
  );
}
