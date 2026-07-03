# PiEEG App — 脳波の取得・集計・Web表示

PiEEG-16 から 16ch の脳波を読み取り、サーバーでバンドパワーに集計して Web にリアルタイム表示する最小構成のアプリです。
[`eeg_roomba/pi_a_acquirer`](../../eeg_roomba) を参考に、**ルンバ制御・LSL・MQTT・TimescaleDB を外し**、
「取得 → 集計 → 表示」だけに絞って移植しています。

![スクリーンショット](docs/screenshot.png)

## 構成

```
PiEEG-16 (SPI)                サーバー (FastAPI)              Web (Vite + TS + Canvas)
┌──────────────┐  WS /ingest  ┌─────────────────────┐  WS /ws  ┌────────────────────┐
│ acquirer/    │ ───────────▶ │ server/             │ ───────▶ │ web/               │
│  codec.py    │  100ms chunk │  スライディング窓 1s │  ~4Hz    │  波形 + バンド棒    │
│  spi_driver  │  {ts,samples}│  band_powers()      │  集計    │  δθαβγ 表示        │
│  simulator   │              │  δ/θ/α/β/γ を計算    │  フレーム│  ブラウザ内simも可 │
└──────────────┘              └─────────────────────┘          └────────────────────┘
```

- **acquirer/** — Raspberry Pi 上で動く取得プロセス。ハードウェア(`spi_driver.PiEEG16`)または
  シミュレータ(`SimulatedPiEEG16`、ハード不要)から 16ch を読み、WebSocket でサーバーへ送信。
- **server/** — FastAPI。`/ingest` で受信 → 1 秒窓で Welch 相当の PSD からバンドパワーを集計 →
  `/ws` に接続した Web クライアントへ ~4Hz で配信。参考プロジェクトの LSL+MQTT+DB を 1 プロセスに集約。
- **web/** — 軽量な Vite + TypeScript + Canvas。**サーバー無しでもブラウザ内シミュレータで動く**ため、
  GitHub Pages にそのまま置いてデモできる。実機接続時は「サーバー接続」を選び `ws://…/ws` を指定。

## セットアップと実行

### 1. シミュレータだけで試す(ハード不要・最速)

Web をローカルで開くだけ。ブラウザ内でEEGを生成して波形とバンドパワーが動きます。

```bash
cd web
npm install
npm run dev        # http://localhost:5173 を開く（「シミュレータ」モードが既定）
```

### 2. サーバー経由(シミュレータ acquirer → サーバー → Web)

```bash
# サーバー
cd server
uv venv && uv pip install -e ".[dev]"
uv run uvicorn main:app --host 0.0.0.0 --port 8000

# 別ターミナル: シミュレータ acquirer をサーバーへ接続
cd acquirer
uv venv && uv pip install -e .
uv run python stream.py --source sim --server ws://localhost:8000/ingest
```

Web を開き「サーバー接続」を選択 → `ws://localhost:8000/ws` → 適用。

### 3. 実機(Raspberry Pi + PiEEG-16)

Pi 上で:

```bash
cd acquirer
uv pip install -e ".[hardware]"    # spidev / gpiod を追加インストール
uv run python stream.py --source hardware --server ws://<サーバーIP>:8000/ingest
```

サーバーは任意の PC で `uvicorn main:app --port 8000`。Web は Pages 版または任意ホストで開き、
`ws://<サーバーIP>:8000/ws` に接続。

## テスト

```bash
# Python（codec の μV 変換、シミュレータ、バンドパワー集計、Hub）
pytest acquirer/tests server/tests -q

# Web（FFT/バンドパワー、シミュレータ）
cd web && npm test

# 型チェック
cd web && npm run typecheck

# 手動E2Eスモーク（サーバー起動後）
python scripts/e2e_check.py
```

## GitHub Pages へのデプロイ

`web/` を静的サイトとしてビルドし Pages に公開します。バックエンドは Pages では動かないため、
公開版は既定でブラウザ内シミュレータが動作します(実機接続はURLで `?mode=server&url=ws://…/ws`)。

1. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定。
2. `main` に push すると `.github/workflows/deploy-pages.yml` が `web/` をビルドして公開。

`vite.config.ts` は `base: "./"`(相対パス)なので、`https://<user>.github.io/<repo>/` の
サブパス配下でもそのまま動きます。

## 参考元からの主な変更点

| 参考元 (eeg_roomba) | 本アプリ |
|---|---|
| LSL outlet + MQTT health | 単一の WebSocket `/ingest` に集約 |
| ingest / feature / decision / api の4サービス | `server/` 1プロセス(集計のみ、decision削除) |
| TimescaleDB 永続化 | 永続化なし(スライディング窓のみ) |
| Pi-B + Arduino + Roomba 制御 | **削除**(表示に専念) |
| React + Three.js + uPlot | 軽量 Vite + TS + Canvas、ブラウザ内sim内蔵 |
| scipy.signal.welch | numpy のみの periodogram(依存軽量化) |

`acquirer/codec.py` と `acquirer/spi_driver.py` は参考元からそのまま移植(μV変換ロジックは不変)。
