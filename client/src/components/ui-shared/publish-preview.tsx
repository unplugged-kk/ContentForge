import { XPostPreview } from "@/components/x-post-preview";

export interface PublishPreviewProps {
  channel: string;
  accountLabel: string;
  text: string;
}

/** Target-account + rendered-content preview shown before a real publish action. */
export function PublishPreview({ channel, accountLabel, text }: PublishPreviewProps) {
  const isTweetLike = channel === "x" || channel === "threads";
  return (
    <div className="space-y-2" data-testid="publish-preview">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Target</span>
        <span className="font-medium" data-testid="text-publish-target">{accountLabel}</span>
      </div>
      {isTweetLike ? (
        <XPostPreview tweets={[text]} handle={accountLabel.replace(/^@/, "")} />
      ) : (
        <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm" data-testid="text-publish-preview-body">
          {text || "(empty)"}
        </p>
      )}
    </div>
  );
}
