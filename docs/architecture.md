# アーキテクチャ図

このアプリが「脳波 → サーバー集計 → Web表示」をどう実現しているかを、2つの粒度で図解します。

- [① 子供向け（めっちゃざっくり）](#-子供向けめっちゃざっくり)
- [② 情報系大学生向け（そこそこ詳細）](#-情報系大学生向けそこそこ詳細)

---

## ① 子供向け（めっちゃざっくり）

> あたまのビリビリを、はこがすうじにして、がめんにおえかきするよ！

```mermaid
flowchart LR
    A["🧠<br/>あたま<br/>（のうのビリビリ）"]
    B["🎧<br/>ぼうし＋きばん<br/>ビリビリをよむ"]
    C["🤖<br/>ちいさいコンピュータ<br/>（ラズパイ）"]
    D["🖥️<br/>サーバー<br/>すうじをまとめる"]
    E["📊<br/>がめん<br/>なみなみ・あたまのいろ"]

    A -->|でんき| B
    B -->|ケーブル| C
    C -->|むせん| D
    D -->|インターネット| E

    style A fill:#fde68a,stroke:#f59e0b,color:#000
    style B fill:#bfdbfe,stroke:#3b82f6,color:#000
    style C fill:#bbf7d0,stroke:#22c55e,color:#000
    style D fill:#ddd6fe,stroke:#8b5cf6,color:#000
    style E fill:#fecaca,stroke:#ef4444,color:#000
```

**やってること（3ステップ）**

1. 🎧 **あたまのビリビリをよむ** … ぼうしの電極が、脳のちいさな電気をひろう
2. 🖥️ **すうじにしてまとめる** … コンピュータが「集中してる？リラックスしてる？」を計算
3. 📊 **がめんにえがく** … なみなみの線や、あたまのどこが元気かを色でみせる

---

## ② 情報系大学生向け（そこそこ詳細）

センサ → 取得 → 集計 → 配信 → 可視化 の各段と、実際に使うプロトコル/ライブラリを示します。
既存の参考プロジェクト（`eeg_roomba`）の LSL 配信を **SPI 非占有**でタップするのがポイント。

```mermaid
flowchart TB
    subgraph HW["🧠 センサ（Raspberry Pi 上）"]
        EEG["PiEEG-16<br/>ADS1299 × 2 チップ<br/>16ch / 250Hz / 24bit"]
        ACQ["pieeg-acquirer.service（参考元）<br/>codec.py: 24bit→μV 変換"]
        EEG -->|"SPI (spidev)<br/>DRDY割込 @250Hz"| ACQ
    end

    subgraph PI["🤖 Raspberry Pi（本アプリ, systemd常駐）"]
        LSLOUT(["LSL outlet<br/>name=PiEEG-16"])
        BRIDGE["acquirer/stream.py --source lsl<br/>pylsl で購読 → 100ms chunk"]
        SERVER["server/main.py（FastAPI）<br/>WS /ingest 受信<br/>スライディング窓 1s / hop 0.25s<br/>aggregate.py: Hann窓+periodogram(numpy)<br/>→ δ/θ/α/β/γ バンドパワー"]
        SERVE["tailscale serve<br/>TLS終端 (wss://)"]
        ACQ -.->|LSL| LSLOUT
        LSLOUT -->|"pull_chunk<br/>(localhost)"| BRIDGE
        BRIDGE -->|"WebSocket JSON<br/>{ts,srate,samples}"| SERVER
        SERVER -->|"WS /ws ~4Hz<br/>{raw, bands, bands_per_ch}"| SERVE
    end

    subgraph WEB["📊 ブラウザ（GitHub Pages / HTTPS）"]
        SRC["source.ts<br/>ServerSource / SimulatorSource"]
        VIEWS["Canvas 描画（依存ゼロ）<br/>・16ch 波形<br/>・バンドパワー棒<br/>・集中/リラックス mind.ts β/(α+θ), α/(α+β)<br/>・頭部トポグラフィ montage.ts 10-20 + IDW補間<br/>・3D電極ドーム brain3d.ts 透視投影+深度ソート"]
        SRC --> VIEWS
    end

    SERVE ==>|"wss:// (TLS, tailnet)"| SRC

    SIMBROWSER["🧪 スタンドアロン demo<br/>simulator.ts をブラウザ内生成<br/>（サーバー不要 = Pages 単体で動く）"]
    SIMBROWSER -.->|fallback| SRC

    style EEG fill:#fde68a,stroke:#f59e0b,color:#000
    style ACQ fill:#fde68a,stroke:#f59e0b,color:#000
    style SERVER fill:#ddd6fe,stroke:#8b5cf6,color:#000
    style BRIDGE fill:#bbf7d0,stroke:#22c55e,color:#000
    style SERVE fill:#bfdbfe,stroke:#3b82f6,color:#000
    style VIEWS fill:#fecaca,stroke:#ef4444,color:#000
    style SIMBROWSER fill:#e2e8f0,stroke:#64748b,color:#000
```

### データフローの要点

| 段 | 実装 | プロトコル / 手法 | 補足 |
|---|---|---|---|
| センサ | ADS1299 ×2 | SPI, DRDY割込 | ±4.5V / gain6 → μV。`codec.py` |
| 取得 | `pieeg-acquirer`（参考元） | LSL outlet | EEG/BCI 業界標準。時刻同期付き |
| 中継 | `stream.py --source lsl` | pylsl → WebSocket | **SPIを奪わない**。参考元と共存 |
| 集計 | `server/main.py` + `aggregate.py` | FastAPI WS, numpy | 窓1s/hop0.25s, Hann+periodogram |
| 配信 | `tailscale serve` | wss:// (TLS) | HTTPS の Pages から接続可に |
| 可視化 | `web/`（Vite+TS+Canvas） | Canvas 2D / 自作3D | ライブラリ非依存で軽量 |

### 2つの動作モード

```mermaid
flowchart LR
    subgraph M1["モードA: 実機（本番）"]
        direction LR
        a1["PiEEG"] --> a2["Pi: bridge+server"] --> a3["wss://"] --> a4["Pages / Web"]
    end
    subgraph M2["モードB: シミュレータ（デモ・CI）"]
        direction LR
        b1["simulator.ts<br/>(ブラウザ内)"] --> b2["Pages / Web"]
    end
```

- **モードA** … 実際の脳波。Pi 上で bridge+server が常駐、`wss://` 経由で表示。
- **モードB** … ハード不要。ブラウザ内で合成EEGを生成するので **GitHub Pages 単体でデモ可能**。
  同じ計算（FFT/バンドパワー）を `fft.ts` がクライアント側で実行。

### 参考元 `eeg_roomba` からの主な簡略化

- ルンバ制御（decision / Pi-B / Arduino）を **削除**
- 4サービス（ingest/feature/decision/api）+ MQTT + TimescaleDB を **server 1プロセス**に集約
- React + Three.js + uPlot → **素の Canvas**（依存ゼロ, ビルド後 JS 約14KB）
- scipy.signal.welch → **numpy のみ**の periodogram
