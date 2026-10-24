# 方式B取消の保存形式（2026-10-23）

§3の信頼モデルは「認可されたAdmin writer＋単一Admin transaction＋関連文書への旧direct writerの書込禁止」。独立署名・外部証拠基盤は要件に追加しない。hashは整合性検査であり、信頼するAdmin自身の一括改変を検出する保証ではない。

repoの firestore.rules は signedIn に sale/lock/movement/session の直接書込を許す。専用隔離Rulesはclient writeをdenyするが、実効認可と移行完了は未証明。現行APIの停止ゲートは維持する。

- protected-void.mjs は保存形式 void-server-v1 を serverVoidV1 に組み立てる。元sale/lock/movement、正規取消意図、actor、再計算に必要な最小数量・revision・session集計、保存結果を結合する。元snapshotは型付きdigestと元serverSaleV1にも照合する。
- serverTimestamp sentinelはhashから分離。確定Timestampの読取時にsale/lock/全returnの監査時刻と保存内容を再構築照合する。実SDKでの保存可否・サイズ上限は未実証（semantic DTOに400KB制限あり）。
- 行別return create、SKU合算、文書ごとのrevision+1、sale/lock/session内イベント集計/取消proofを同じwrite setに含める。対象外stock metadataのTimestampを維持する。receiptはlock内serverVoidV1であり新台帳を作らない。
- transactは注入された一つのtransactionで毎回読取→検証→全writeをstageし、runTransactionの完了後だけ結果を返す。失敗/不明ackを成功へ変換しない。初回closed拒否、同取消再送と販売commit/result共通照合、不存在時の予約作成なし。
- authorizeReadは信頼するサーバーadapter専用。完全なquery unionとsnapshotの出所、保護されたwriter境界を確認する責務がある。HTTP/DB内のboolean・UID・self hashを根拠にtrueを返してはいけない。実adapter未接続。callbackやfixture WeakSetが稼働認可を証明したとは扱わない。

今回最終実行は107 PASS/0 FAIL（既存85を再実行＋新規22）。前回85 PASSとは別の実行。最初のテスト側2不備とpreflight停止は evidence に記録。実SDK・認可・原子性・commit ack・V01〜V10は未合格。

次の最小工程は、旧writer隔離を確認できる読取adapterと実Admin Timestamp/transaction adapterの接続前検証。現在はEmulator起動禁止・環境隔離未証明なので実行しない。今のユーザー設定変更は不要。独立tamper-evidenceまで要求する場合のみ別途管理者判断が必要。
