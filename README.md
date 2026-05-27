# IWARE antique

写真アップロード、価格入力、在庫登録確認を3ステップで共有するアプリです。

## 本番URL化の手順

1. Supabaseで新規プロジェクトを作成
2. Supabase SQL Editorで [supabase-schema.sql](./supabase-schema.sql) を実行
3. Supabaseの Project URL と anon public key を取得
4. [config.js](./config.js) に入力

```js
window.IWARE_CONFIG = {
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseAnonKey: "your-anon-key",
  photoBucket: "iware-photos",
};
```

5. Vercelにこのフォルダをデプロイ

## 使い方

1. `Upload` で写真をまとめて追加
2. `Pricing` で価格を入力して完了
3. `Review` で登録したものにチェック
4. 全部チェックしたら最後の完了でクリア

## 保存先

Supabase設定が入っている場合:

- 写真: Supabase Storage
- 価格と状態: Supabase Database

Supabase設定が空の場合:

- このブラウザ内だけに保存されます
