# Voxel Town 3D

Vite + TypeScript + Three.js で作った、ローポリボクセル調の町とかくれんぼゲームのプロトタイプです。

## Current Game

- 画面は鬼視点のみです。
- 隠れる側はAIで逃げます。
- 鬼は少し足が速いです。
- 鬼の視界コーン、足音メーター、視界メーター、捕獲判定があります。

## Run

```powershell
npm.cmd install
npm.cmd run dev
```

## Controls

- `W/S`: 前進/後退
- `A/D`: 視点回転
- モバイル: 右下のスティックで前進/後退/旋回
- `R`: リセット

## Texture Prompt

The project uses a 4x4 town material atlas at `public/textures/town-texture-atlas.png`.
The SVG source is kept beside it as `public/textures/town-texture-atlas.svg`.

The image-generation prompt used for the atlas direction was:

```text
Generate ONLY a 4x4 grid of flat square ground/building material textures for a Three.js low-poly voxel town: grass, asphalt road, concrete sidewalk, red roof, blue gray roof, cream wall, beige school wall, green school roof, vacant-lot dirt, reddish schoolyard dirt, tree canopy, forest path dirt, canal water, concrete pipe material, garden shrubs, and pale gravel. No text, no labels, no characters, no logos, no single central subject.
```
