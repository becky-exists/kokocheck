import type { Locale } from './locale.js';
export const errorMessages = {
  "review_not_found": {
    "ja": "レビューが見つかりません。",
    "en": "Review not found."
  },
  "video_format": {
    "ja": "H.264形式のMP4を選んでください。HEVC/MOVは事前に変換してください。",
    "en": "Choose an H.264 MP4. Convert HEVC or MOV files first."
  },
  "audio_format": {
    "ja": "音声をAAC形式に変換してください。",
    "en": "Convert the audio to AAC."
  },
  "video_duration": {
    "ja": "対応する動画の長さは2時間までです。",
    "en": "Videos must be no longer than 2 hours."
  },
  "video_unreadable": {
    "ja": "動画を読み取れませんでした。MP4形式とFFmpegのインストールを確認してください。",
    "en": "Could not read the video. Check the MP4 format and FFmpeg installation."
  },
  "snapshot_empty": {
    "ja": "この位置の画像を取得できません。少し手前で止めてください。",
    "en": "Could not capture this frame. Try a slightly earlier position."
  },
  "snapshot_failed": {
    "ja": "画像を取得できませんでした。少し手前の位置で再度お試しください。",
    "en": "Could not capture a snapshot. Try a slightly earlier position."
  },
  "source_ref_required": {
    "ja": "生成元を識別する sourceRef が必要です。",
    "en": "A sourceRef identifying the editable project is required."
  },
  "invalid_time": {
    "ja": "動画内の有効な時刻・範囲を指定してください。",
    "en": "Choose a valid time or range within the video."
  },
  "version_not_found": {
    "ja": "対象の版がありません。",
    "en": "Version not found."
  },
  "new_version": {
    "ja": "新しい版が届いています。最新版を開いて指摘してください。",
    "en": "A newer version is available. Open it to add comments."
  },
  "comment_limit": {
    "ja": "このレビューの指摘数の上限に達しました。",
    "en": "This review has reached its comment limit."
  },
  "original_not_found": {
    "ja": "元の指摘が見つかりません。",
    "en": "Original comment not found."
  },
  "followup_conflict": {
    "ja": "進行中または引き継ぎ済みの指摘は再登録できません。",
    "en": "Cannot add a follow-up to an in-progress or superseded comment."
  },
  "latest_required": {
    "ja": "最新版から依頼してください。",
    "en": "Send requests from the latest version."
  },
  "request_in_progress": {
    "ja": "先の依頼が進行中です。完了後に次の依頼を送れます。",
    "en": "A request is already in progress. Wait for it to finish."
  },
  "comment_selection": {
    "ja": "指摘を1〜100件選んでください。",
    "en": "Select between 1 and 100 comments."
  },
  "drafts_only": {
    "ja": "未依頼の指摘だけを選んでください。",
    "en": "Select only unsent comments."
  },
  "request_not_found": {
    "ja": "依頼がありません。",
    "en": "Request not found."
  },
  "already_claimed": {
    "ja": "この依頼は取得済みです。",
    "en": "This request has already been claimed."
  },
  "wrong_agent": {
    "ja": "この依頼は別のエージェント宛てです。",
    "en": "This request targets a different agent."
  },
  "lease_expired": {
    "ja": "作業権が失効しています。自動再実行せず、依頼の状態を確認してください。",
    "en": "Your work lease has expired. Check the request status; do not retry edits automatically."
  },
  "release_conflict": {
    "ja": "手放せる依頼ではありません。作業権が別の担当に移ったか 既に完了しています。",
    "en": "Cannot release this request. Its lease belongs to someone else or the work has ended."
  },
  "notification_not_unsent": {
    "ja": "未送信と確認できた通知だけを再送・取り消しできます。",
    "en": "Only notifications known not to have been delivered can be resent or cancelled."
  },
  "base_version_mismatch": {
    "ja": "元の版が一致しません。",
    "en": "The base version does not match."
  },
  "change_reports_required": {
    "ja": "依頼された各指摘に1件ずつ結果を報告してください。",
    "en": "Report exactly one result for each requested comment."
  },
  "before_range": {
    "ja": "修正前の範囲が動画を超えています。",
    "en": "The before range exceeds the video duration."
  },
  "before_missing_comment": {
    "ja": "修正前の範囲には指摘位置を含めてください。",
    "en": "The before range must include the comment position."
  },
  "after_range": {
    "ja": "修正後の範囲が動画を超えています。",
    "en": "The after range exceeds the revised video duration."
  },
  "notification_config": {
    "ja": "通知の設定ファイルを読み込めません。制作側で notify-codex.json / notify-claude.json を確認してください。",
    "en": "Cannot read notification settings. Ask the producer to check notify-codex.json and notify-claude.json."
  },
  "notification_ambiguous": {
    "ja": "このレビューはCodexとClaudeの両方に接続されています。制作側で設定を1つにしてください。",
    "en": "This review is connected to both Codex and Claude. Ask the producer to choose one destination."
  },
  "mp4_required": {
    "ja": "MP4ファイルを選んでください。",
    "en": "Choose an MP4 file."
  },
  "host_forbidden": {
    "ja": "このホストは許可されていません。",
    "en": "This host is not allowed."
  },
  "origin_forbidden": {
    "ja": "別のサイトからの操作は許可されていません。",
    "en": "Requests from another site are not allowed."
  },
  "review_access": {
    "ja": "このレビューの共有リンクから開いてください。",
    "en": "Open this review using its shared link."
  },
  "admin_login": {
    "ja": "管理端末で開くか、管理キーでログインしてください。",
    "en": "Open on the operator device or sign in with an admin key."
  },
  "admin_required": {
    "ja": "制作側の認証が必要です。",
    "en": "Producer authentication is required."
  },
  "local_session_disabled": {
    "ja": "この設定ではローカル自動ログインは無効です。管理キーでログインしてください。",
    "en": "Local automatic login is disabled. Sign in with an admin key."
  },
  "local_only": {
    "ja": "管理端末からアクセスしてください。",
    "en": "Open this from the operator device."
  },
  "invalid_admin_key": {
    "ja": "管理キーが一致しません。",
    "en": "The admin key does not match."
  },
  "video_required": {
    "ja": "動画を選んでください。",
    "en": "Choose a video."
  },
  "source_required": {
    "ja": "生成元を指定してください。",
    "en": "Specify the editable source."
  },
  "file_not_found": {
    "ja": "ファイルがありません。",
    "en": "File not found."
  },
  "comment_not_found": {
    "ja": "指摘がありません。",
    "en": "Comment not found."
  },
  "comment_frozen": {
    "ja": "送信済みの指摘は変更できません。返信か新しい指摘を追加してください。",
    "en": "Sent comments cannot be changed. Add a reply or a new comment."
  },
  "accept_reported_only": {
    "ja": "修正報告がある指摘だけをOKにできます。",
    "en": "Only comments with a revision report can be approved."
  },
  "reply_limit": {
    "ja": "返信数の上限です。",
    "en": "The reply limit has been reached."
  },
  "chat_connected": {
    "ja": "このレビューは制作チャットに接続されています。画面を更新してください。",
    "en": "This review is connected to a production chat. Refresh the page."
  },
  "chat_not_connected": {
    "ja": "このレビューは制作チャットに接続されていません。",
    "en": "This review is not connected to a production chat."
  },
  "destination_changed": {
    "ja": "この依頼の宛先と現在の接続先が違います。取り消して出し直してください。",
    "en": "The destination has changed. Cancel this request and submit it again."
  },
  "requeue_conflict": {
    "ja": "失敗または作業権切れの依頼だけを再受付できます。",
    "en": "Only failed requests or expired work leases can be requeued."
  },
  "other_work_active": {
    "ja": "別の版または依頼が進行しています。",
    "en": "Another version or request is in progress."
  },
  "revision_required": {
    "ja": "修正版のMP4を添付してください。",
    "en": "Attach the revised MP4."
  },
  "api_not_found": {
    "ja": "APIが見つかりません。",
    "en": "API endpoint not found."
  },
  "invalid_input": {
    "ja": "入力内容を確認してください。",
    "en": "Check the submitted values."
  },
  "upload_size": {
    "ja": "動画は512MBまでです。",
    "en": "Videos must be no larger than 512 MB."
  },
  "upload_format": {
    "ja": "アップロードの形式を確認してください。",
    "en": "Check the upload format."
  },
  "invalid_json": {
    "ja": "JSONの形式を確認してください。",
    "en": "Check the JSON format."
  },
  "internal_error": {
    "ja": "処理に失敗しました。制作側のログを確認してください。",
    "en": "The operation failed. Ask the producer to check the server logs."
  },
  "producer_stopped": {
    "ja": "制作側で処理が止まりました。",
    "en": "Processing stopped on the producer side."
  },
  "invalid_direction": {
    "ja": "演出の選択と文言を確認してください",
    "en": "Check the selected styles and text."
  },
  "invalid_scope": {
    "ja": "動画全体への指示には、時刻・ピン・「ここ」向けの演出は付けられません。",
    "en": "A whole-video comment cannot have a time, a pin or per-moment styles."
  },
  "invalid_range_end": {
    "ja": "終了時刻は開始時刻以降にしてください。",
    "en": "The end must be at or after the start."
  }
} as const;
export type ErrorCode = keyof typeof errorMessages;
export function errorMessageFor(value: string, lang: Locale): string | undefined {
  if (Object.hasOwn(errorMessages, value)) return errorMessages[value as ErrorCode][lang];
  return Object.values(errorMessages).find(item => item.ja === value || item.en === value)?.[lang];
}
