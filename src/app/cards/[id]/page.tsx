import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CardView } from "@/components/game/card-shogi/card-view";
import { BgmProvider } from "@/components/audio/bgm-provider";
import { CARD_DEFS } from "@/lib/shogi/cards/definitions";
import {
  CHECK_USAGE_INFO,
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
    // 詳細ポップアップ (CardDetailDialog) と同じ「ヘッダ固定 + 本文スクロール」
    // パターンに揃える。
    <main className="h-dvh flex flex-col bg-gradient-to-b from-amber-50 dark:from-amber-950/30 to-background">
      <BgmProvider eventKey="bgm_home" />
      <div className="max-w-4xl mx-auto px-4 pt-4 sm:pt-6 pb-2 w-full flex flex-col flex-1 min-h-0">
        {/* 戻るリンク + 名前 (固定) */}
        <header className="flex items-center gap-3 mb-3 sm:mb-4 shrink-0">
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

        {/* 固定ヘッダ: 実物プレビュー + バッジ */}
        <div className="shrink-0 flex flex-col gap-3 items-center pb-3 mb-3 border-b">
          <div className="hidden md:block">
            {/* PC ヘッダは縦長すぎて下のテキストがスクロール内に押し込まれるため、
                横幅は維持しつつ縦幅だけ縮める (デフォルト 22rem → 16rem)。
                内側のコスト+アイコン (text-9xl=128px) と padding (p-6=48px) で
                約 17rem 分が必要なため 16rem が下限の目安。 */}
            <CardView
              card={{ instanceId: `detail-${def.id}`, defId: def.id }}
              size="xl"
              className="h-[16rem]"
            />
          </div>
          <div className="md:hidden w-full max-w-sm">
            <CardView
              card={{ instanceId: `detail-${def.id}`, defId: def.id }}
              size="lg"
              fullWidth
            />
          </div>
          <div className="flex flex-wrap gap-1.5 justify-center">
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
        </div>

        {/* スクロール可能本文: 概要 / 詳細 / 使用条件 / メタ */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-2 flex flex-col gap-4 pb-4">
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

          {def.useConditionDescription && (
            <section>
              <h2 className="text-sm font-bold mb-1">使用条件</h2>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {def.useConditionDescription}
              </p>
            </section>
          )}

          {/* 王手中の使用可否 (Issue #82): 効果詳細・使用条件と同列のメタ情報として
              専用セクションで表示する。詳細記述内に文として埋もれさせない。 */}
          <section>
            <h2 className="text-sm font-bold mb-1.5">王手中の使用</h2>
            <div className="flex flex-col gap-1.5">
              <Badge
                variant="outline"
                className={cn("text-xs w-fit", CHECK_USAGE_INFO[def.checkUsage].className)}
              >
                {CHECK_USAGE_INFO[def.checkUsage].label}
              </Badge>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {CHECK_USAGE_INFO[def.checkUsage].description}
              </p>
            </div>
          </section>

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
