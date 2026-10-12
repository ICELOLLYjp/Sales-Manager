# 方式B 限定実装・再開入口

承認：2026-10-12のユーザー指示により方式Bを採用。承認範囲は隔離環境の手動在庫編集APIのみ。本番配備・工程B・既存POS移行は未承認。

作業ブランチ `codex/stage-a-method-b-isolated-20261012`。出発点はSales #121 `71ec1d77691aaa2e194d0eebb55ce207b546b200`、PR baseは同PRの `codex/inventory-concurrency-a-20261012`。既存PRを変更しない。元の診断・RFC・証拠は履歴として保持する。

| 段階 | 状態 | 成果・検証 | 次の具体作業 |
| --- | --- | --- | --- |
| 1 書込経路調査 | 完了 | METHOD_B_WRITE_PATHS.md。最新head/main照合、静的経路確認。試験再実行なし | 操作別契約・認可・receipt互換性を定義 |
| 2 API契約/認可 | 完了 | METHOD_B_API_CONTRACT.md。固定SKU操作、厳格revision、3架空UID、旧receipt拒否。実装/認証試験は未実施 | 隔離Auth/Firestore Admin＋HTTP API実装 |
| 3 最小実装 | 限定実装済み | f7e5d7b。runtime/inventory/http、専用Rules/config、固定依存lock。第4段階で上限revisionの再送を補正 | 製品への適用は未実装 |
| 4 隔離試験 | 完了・隔離範囲のみ合格 | 新API25/25成功、fail/skip/todo 0。METHOD_B_VALIDATION.mdとevidence参照。旧32件不変 | 第5段階のPOS互換性・引継ぎ整理 |
| 5 引継ぎ | 未着手 | 工程A配備不可・工程B不可 | POS/端末/移行未対応と次の判断を整理 |

各段階を別コミットで保存してpushする。最新headとこの表を確認し、完了段階を繰り返さない。途中で利用枠/停止条件に達したら、未完成として記録して停止する。

保存済み：第1段階 `34e4c86`、Draft PR #123。第2段階も独立コミットとして保存。異SKU双方成功のC01とは異なり、最小APIは全revision競合を安全拒否する契約。

第2段階 `cbebc38`。第3段階は実装途中として保存し、Emulator安全試験前の完成主張をしない。依存installのdeprecated警告（node-domexception/glob）は記録し、今回production依存は変更しない。次に試験runner/証拠保存を追加する。

## 現在の停止点（2026-10-12 19:30 JST）

第4段階終了時に利用枠の5時間枠93%使用を確認。ユーザー指示により**第5段階は開始せず保存して停止**。第3段階の「未検証」は当時の記録で、現在は25件の隔離検証済み。工程A配備不可・工程B不可。

次回はGitHub #123最新headと本表を読む。1〜4を再実行せず、第5段階として既存POS/オフラインキュー/旧端末/SW/認証期限/API停止の互換性条件をソースと照合し、未実装・未検証・次の承認を整理して別コミット/pushする。既存PR #121、Website #22、T-shirts #41、Accessories #22は読み取りのみ。POS全面移行、実UID/IAM取得、デプロイは行わない。新APIを変えた場合だけ影響試験を再実行。
