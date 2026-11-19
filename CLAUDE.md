# CLAUDE.md — 常に守るルール
- 目標: ロード画面のないオープンワールドMMO風アクションRPG(Three.js + Vite、静的ホスティング)。
- 既存の動作機能(移動・滑空・チャンク配信)を壊さない。ダミー実装禁止。
- 地形は `height(x,z)` の純関数。全システム(配置・当たり判定・色)がこれを共有する。チャンク境界の継ぎ目はこの設計で防ぐ。
- 参照画像(public/assets/reference.jpeg)の色調: 暖色の霞、青紫の影、淡い空気遠近。
- iPad Safari優先: DPR上限2、影2048、タッチ操作(左スティック/右ドラッグ/ジャンプ)。
- 調査済み情報は本ファイルと PROGRESS.md を再利用。同じ調査を繰り返さない。
- キャラ: public/assets/character.glb (MMD系499ボーン、アニメは Run / Climbing のみ)。向きが逆なら `?flip=1`。
