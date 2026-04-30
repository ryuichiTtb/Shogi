import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const VARIANTS = [
  {
    href: "/mock/card-shogi-a",
    title: "A案: 上下分割",
    summary: "相手のカード要素を上端、自分のカード要素を下端に配置。盤面は中央。トランプ的定番レイアウト。",
    pros: ["対称性が高く認知負荷が低い", "手札・マナが常時視認できる"],
    cons: ["モバイル縦長で盤面が圧迫される最大級"],
  },
  {
    href: "/mock/card-shogi-b",
    title: "B案: ボトムドロワー",
    summary: "手札は通常時は最小化、ボタンタップで下からスライドアップ。盤面サイズを最大化する。",
    pros: ["盤面が最大サイズ", "親指リーチ最適化"],
    cons: ["手札の即時参照に2タップ必要", "相手手札の認知が落ちる"],
  },
  {
    href: "/mock/card-shogi-c",
    title: "C案: オーバーレイ + 縦サイド",
    summary: "PCでは右サイドに手札を縦並びで常設、モバイルでは下端に横並びで配置。",
    pros: ["PCでは盤面を縦に長く使える", "手札が常に視野"],
    cons: ["モバイル時はA案と類似 (ハイブリッド設計)"],
  },
];

export default function MockIndex() {
  return (
    <main className="min-h-dvh py-6 px-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">カード将棋 UI モック (Phase 0a)</h1>
          <p className="text-sm text-muted-foreground">
            Issue #68 のレイアウト評価用モック。各案を PC とモバイル(DevTools or 実機)で触り、評価軸に沿って比較してください。
          </p>
          <p className="text-xs text-muted-foreground">
            各案は本番ではなく、Phase 0c で削除します。状態管理は最小限で、効果は発動しません(ダイアログ確認のみ)。
          </p>
        </header>

        <div className="text-sm space-y-1 rounded-md border bg-card p-3">
          <div className="font-bold">評価軸 (Plan の 0b に基づく)</div>
          <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
            <li>盤面の視認性(モバイル縦)</li>
            <li>自分手札のアクセシビリティ(タップ精度)</li>
            <li>相手手札の認知性</li>
            <li>マナゲージの常時視認</li>
            <li>トラップスロットの位置感(自分・相手の対称性)</li>
            <li>誤タップしにくさ(safe-area込み)</li>
            <li>操作の発見可能性</li>
            <li>盤面操作とカード操作のモード混乱がないか</li>
            <li>既存標準将棋画面との一貫性</li>
          </ul>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          {VARIANTS.map((v) => (
            <Link key={v.href} href={v.href}>
              <Card className="h-full hover:border-primary hover:shadow-md transition-all cursor-pointer">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{v.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-2 text-muted-foreground">
                  <p>{v.summary}</p>
                  <div>
                    <div className="font-bold text-emerald-700 dark:text-emerald-400">利点</div>
                    <ul className="list-disc list-inside">
                      {v.pros.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  </div>
                  <div>
                    <div className="font-bold text-red-700 dark:text-red-400">欠点</div>
                    <ul className="list-disc list-inside">
                      {v.cons.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="text-xs text-muted-foreground border-t pt-3">
          <Link href="/" className="hover:underline">← トップページに戻る</Link>
        </div>
      </div>
    </main>
  );
}
