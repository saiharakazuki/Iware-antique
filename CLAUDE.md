# IWARE antique

## 構成
- デプロイ先: Vercel
- データベース: Supabase Database
- ストレージ: Supabase Storage
- 認証: なし
- CI: 現時点では静的HTML/CSS/JSのため未設定

## 本番用メモ
- 写真は Supabase Storage の `iware-photos` bucket に保存する
- 商品状態と価格は Supabase の `inventory_items` table に保存する
- ブラウザ公開キーのみ `config.js` に入れる
- secret key / service role key は公開しない
