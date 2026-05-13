import { type ServerProvider } from "@t3tools/contracts";
import { memo, useEffect, useMemo, useState } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { formatProviderDriverKindLabel } from "../../providerModels";

export const ProviderStatusBanner = memo(function ProviderStatusBanner({
  status,
}: {
  status: ServerProvider | null;
}) {
  const dismissKey = useMemo(() => {
    if (!status || status.status === "ready" || status.status === "disabled") {
      return null;
    }
    return [
      status.instanceId,
      status.status,
      status.checkedAt,
      status.message ?? "",
      status.auth.status,
    ].join("\n");
  }, [status]);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    if (dismissKey !== dismissedKey) {
      setDismissedKey(null);
    }
  }, [dismissKey, dismissedKey]);

  if (!status || status.status === "ready" || status.status === "disabled") {
    return null;
  }
  if (dismissKey !== null && dismissedKey === dismissKey) {
    return null;
  }

  const providerLabel = status.displayName?.trim() || formatProviderDriverKindLabel(status.driver);
  const defaultMessage =
    status.status === "error"
      ? `${providerLabel} provider is unavailable.`
      : `${providerLabel} provider has limited availability.`;
  const title = `${providerLabel} provider status`;

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={status.status === "error" ? "error" : "warning"}>
        <CircleAlertIcon />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="line-clamp-3" title={status.message ?? defaultMessage}>
          {status.message ?? defaultMessage}
        </AlertDescription>
        {dismissKey !== null && (
          <AlertAction>
            <button
              type="button"
              aria-label="Dismiss provider status"
              className="inline-flex size-6 items-center justify-center rounded-md text-destructive/60 transition-colors hover:text-destructive"
              onClick={() => setDismissedKey(dismissKey)}
            >
              <XIcon className="size-3.5" />
            </button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
});
