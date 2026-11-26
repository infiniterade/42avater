# 42GRAM アバター（IID Punks Avatars）

42GRAM のアバター NFT です。IID Punks のドット絵のパーツから選んで作り、**CAW NAME 1つにつき1体**、無料でミントできます。
絵はチェーン上に置いたパーツから、表示のたびにコントラクトが SVG に組み立てます。

> **未監査・実験版です。** コントラクトは第三者の監査を受けていません。デプロイ前に監査を受けてください。

## しくみ

- **アバター本体**（`IIDPunksAvatars`, ERC-721）：ミント時に選んだパーツの組み合わせ（トークン記録・最大 69 バイト）を保存し、**以後は変更できません**。
  - CAW NAME（`CawNamesV2`）の持ち主だけがミントでき、1つの CAW NAME は1回だけ（売っても再利用不可）。`avatarOfCaw` / `cawOfAvatar` で相互に引けます。
  - CAW NAME のアドレスはデプロイ後に `setCawNames()` で **1回だけ** 設定します。設定するまでミントできません（CAW NFT のローンチ前にデプロイしておけます）。
  - 同じ見た目（全ピクセルの色の keccak256 = `lookHash`）は1体だけ。
  - デザインのルール（組み合わせてよいパーツ）は、メーカーのバックエンドが EIP-712 で署名して確かめます。
- **特別アイテム**（`IIDPunksItems`, ERC-1155）：帽子・メガネ・口元・首・背景・髪色の6か所に1つずつ付け外しできます。
  - 付けている間はアバターのコントラクトが預かり、付けた場所の元のパーツは表示上だけ隠れます。外せばミント時の絵に戻ります。アバターを譲るとアイテムも一緒に移ります。
  - 髪色のアイテムは絵を持たず、髪のピクセルを帯の色で塗り替えます（例：レインボーヘアカラー）。
  - 新しいアイテムは後から `addItem()` で追加できます。一度追加した図案は変更できません。
  - **ローンチ記念**：`setLaunch(ids, 終了時刻)` の期間中、アバター1体につき対象アイテムを1つずつ無料で受け取れます（`claimLaunch`、持ち主のみ・1体1回）。
- **描画**（`IIDPunksRenderer`）：パーツデータ（約 18KB）を SSTORE2 で1回だけ書き込み、`tokenURI` で SVG と JSON を組み立てます。

## フォルダー

| パス | 中身 |
| --- | --- |
| `src/IIDPunksAvatars.sol` | Renderer・Items・Avatars の3つのコントラクト |
| `test/Avatars.t.sol` | Foundry のテスト（コントラクトの出力がエンジンと一致するか、ミント、アイテム） |
| `data/` | `setData` と `addItem` に渡すデータ、テストの正解データ（`tools/make_data.js` が作る） |
| `tools/` | 描画エンジン（JS）。メーカーとコントラクトの共通の基準。`parts.json` がパーツ表 |
| `tools/pipeline/` | パーツ表 `parts.json` を IID Punks の生成パイプライン（v27、別管理）から書き出すスクリプトと、メーカー専用の追加パーツ |
| `maker/` | アバターメーカーのページ（`node maker/build.js` で `maker/dist/index.html` を作る） |

## 確かめる

必要なもの：Node.js 22 以上、[Foundry](https://getfoundry.sh/)。`lib/` はリポジトリのものを使います（`git submodule update --init`）。

```sh
cd avatars
node tools/make_data.js --check   # data/ がエンジンの出力と同じか
node tools/test_keccak.js         # lookHash に使う keccak256
node tools/test_onchain.js        # コントラクトと同じ手順の描画 == エンジン（2万体）
node tools/test_items.js          # 特別アイテムを付けても一致・記録は不変
forge build --sizes
forge test -vvv                   # 21件
node maker/build.js               # メーカーのページ
```

パーツやアイテムを変えたら `node tools/make_data.js` で `data/` を作り直してください（CI は `--check` で確かめます）。

**整形について**：`forge fmt` はこのフォルダーにかけないでください。Foundry 1.5.1 の整形で、`if (…) { a; continue; }` の波かっこが外れて意味が変わることを確かめています。

## ガス（Foundry の計測、2026-11-26）

| 操作 | ガス |
| --- | --- |
| Renderer の設置＋パーツ書き込み | 約 670万 |
| ミント | 約 165万 |
| ローンチ記念の受け取り（11種） | 約 57万 |
| アイテムを付ける | 約 6万 |
| `tokenURI`（背景あり） | 約 690万 |

## デプロイの順番

1. `IIDPunksRenderer` → `setData(data/parts.bin, data/strings.bin)`（1回だけ）
2. `IIDPunksItems(renderer)` → `data/items.json` の順に `addItem`
3. `IIDPunksAvatars(renderer, items, 署名者, 価格 0, 上限)` → `items.setAvatars(avatars)`
4. CAW NFT のローンチ後：`avatars.setCawNames(CawNamesV2 のアドレス)`、`items.setLaunch(ids, 終了時刻)`
5. メーカーの `CHAIN = { rpc, avatars }` を設定（ミント済みの確認に使います）

## まだのこと

- 第三者の監査
- 署名サーバー（デザインのルールを確かめて EIP-712 で署名）と、ウォレットをつないでミント・アイテムの付け外しをする画面
- 42 Chain（テスト）での通し確認：テスト用 CAW NFT `0xa67874FFAD0b8a0c1E587e1357fD03494518176D`
- パーツの絵のライセンス（IID Punks の図案を MIT にするか、CAW のロゴと同じく対象外にするか）
