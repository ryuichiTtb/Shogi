// Issue #117 (#128): ルートレベル error boundary。
// Server Action エラー / SSR 例外がここに集約される。Chrome NETERR を回避し
// ユーザーに有効な情報を見せ、再試行導線を提供する。
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { MaskedLink } from "@/components/navigation/masked-link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // ブラウザコンソールに詳細を残し、本番でも追跡可能にする。
    console.error("[app/error] Unhandled error:", error);
  }, [error]);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-10 bg-background text-foreground">
      <div className="max-w-md w-full text-center space-y-4">
        <AlertTriangle className="w-12 h-12 mx-auto text-destructive opacity-80" aria-hidden />
        <h1 className="text-xl font-bold">エラーが発生しました</h1>
        <p className="text-sm text-muted-foreground">
          一時的な問題かもしれません。再試行してもうまく行かない場合はホームへ戻ってください。
        </p>
        {error.digest && (
          <p className="text-[10px] text-muted-foreground/70 font-mono break-all">
            digest: {error.digest}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          <Button onClick={reset} variant="default">
            <RefreshCw className="w-4 h-4 mr-1.5" />
            再試行
          </Button>
          <MaskedLink href="/" loadingVariant="spinner">
            <Button variant="outline">
              <Home className="w-4 h-4 mr-1.5" />
              ホームへ
            </Button>
          </MaskedLink>
        </div>
      </div>
    </main>
  );
}
