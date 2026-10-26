# 文明演化模拟器

一个政治经济学沙盒。玩家只设定一个民族的初始文化倾向（资源配置、土地归属、领袖产生方式等 9 个维度，每项都可以不指定），然后观察上千个有能力、有性格、有需求的小人，在真实的环境约束下自发演化出制度、阶层、领袖与科技。

完整设计见 [DESIGN.md](DESIGN.md)。

## 运行

```bash
npm install
npm run dev
```

## 玩法

- 设置界面：选择世界种子、出生地、初始人口和文化倾向（或选一个模板）。
- 游戏中：空格暂停/继续；1×（1 秒 1 天）到 100× 调速；"快进到大事件"一直运行到下一个改革、政变、革命、饥荒或时代更替。
- 点击地图上的聚落查看居民，点击任何小人查看能力、性格、需求、财产、家庭、政治倾向和生平。
- "制度"页可以看到每个选项按权力加权和按全体成年人的支持度，也可以发起思潮。
- "诊断"页解释社会为什么发展或停滞。"参数"页可调整所有机制系数。

## 对比实验

同一种子、不同文化，无界面批量运行，导出逐年统计：

```bash
npm run experiment -- --seed demo --years 200 --presets primitive,liberal,planned --out results.csv
```

可选：`--params punishment=0,dunbar=100` 覆盖机制系数；`--grant agriculture,pottery` 让世界一开始就掌握这些科技（用于校准）。

## 开发

```bash
npm test          # 确定性、存档、指令回放等测试
npm run typecheck
npm run build     # 输出到 dist/
```

推送到 `main` 后，`.github/workflows/deploy.yml` 会自动构建并部署到 GitHub Pages（需要在仓库设置里把 Pages 的来源设为 GitHub Actions）。

模拟核心 `src/core` 是纯逻辑、完全确定的：只用带种子的随机数和 `dmath.ts` 里的数学函数，所有玩家操作都走指令队列。修改核心代码时请保持这一点（见 DESIGN.md §8.2）。
