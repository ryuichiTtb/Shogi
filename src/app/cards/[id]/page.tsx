import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CardView } from "@/components/game/card-shogi/card-view";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import {
  KIND_INFO,
  RARITY_INFO,
  STATUS_INFO,
  TARGETING_LABEL,
} from "@/lib/shogi/cards/labels";
import type { CardId } from "@/lib/shogi/cards/types";
import { cn } from "@/lib/utils";

interface CardDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: CardDetailPageProps) {
  const { id } = await params;
  const def = CARD_DEFS[id as CardId];
  if (!def) return { title: "カード詳細 | カード将棋" };
  return { title: `${def.name} | カード一覧` };
}

export default async function CardDetailPage({ params }: CardDetailPageProps) {
  const { id } = await params;
  const def = CARD_DEFS[id as CardId];

  if (!def) {
    notFound();
  }

  const statusInfo = STATUS_INFO[def.status];
  const kindInfo = KIND_INFO[def.kind];
  const rarityInfo = RARITY_INFO[def.rarity];

  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 dark:from-amber-950/30 to-background">
      <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6">
        <header className="flex items-center gap-3 mb-4 sm:mb-6">
          <Link
            href="/cards"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            aria-label="カード一覧へ戻る"
          >
            <ArrowLeft className="w-4 h-4" />
            カード一覧
          </Link>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{def.name}</h1>
            <p className="text-xs sm:text-sm text-muted-foreground font-mono">{def.id}</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 lg:gap-8 items-start">
          {/* 実物大プレビュー */}
          <div className="flex justify-center lg:justify-start">
            {/* xl サイズはモバイルでは大きすぎるので、md 以上で xl 表示。それ未満は lg にスケールダウン */}
            <div className="hidden md:block">
              <CardView
                card={{ instanceId: `detail-${def.id}`, defId: def.id }}
                size="xl"
              />
            </div>
            <div className="md:hidden w-full max-w-sm">
              <CardView
                card={{ instanceId: `detail-${def.id}`, defId: def.id }}
                size="lg"
                fullWidth
              />
            </div>
          </div>

          {/* メタ情報 + 詳細 */}
          <div className="flex flex-col gap-4">
            {/* バッジ群 */}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className={cn("text-xs", statusInfo.className)}>
                {statusInfo.label}
              </Badge>
              <Badge variant="outline" className={cn("text-xs", kindInfo.className)}>
                {kindInfo.label}
              </Badge>
              <Badge variant="outline" className={cn("text-xs", rarityInfo.className)}>
                {rarityInfo.label}
              </Badge>
            </div>

            {/* 説明文 */}
            <section>
              <h2 className="text-sm font-bold mb-1">効果概要</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{def.description}</p>
            </section>

            {def.detailDescription && (
              <section>
                <h2 className="text-sm font-bold mb-1">効果詳細仕様</h2>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {def.detailDescription}
                </p>
              </section>
            )}

            {/* メタ情報テーブル */}
            <section>
              <h2 className="text-sm font-bold mb-2">メタ情報</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <MetaRow label="ID" value={<span className="font-mono">{def.id}</span>} />
                <MetaRow label="コスト" value={`${def.cost} マナ`} />
                <MetaRow label="ターゲット" value={TARGETING_LABEL[def.targeting]} />
                <MetaRow label="effectId" value={<span className="font-mono">{def.effectId}</span>} />
                {def.addedAt && <MetaRow label="追加日" value={def.addedAt} />}
              </dl>
            </section>

          </div>
        </div>
      </div>
    </main>
  );
}

interface MetaRowProps {
  label: string;
  value: React.ReactNode;
}

function MetaRow({ label, value }: MetaRowProps) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
