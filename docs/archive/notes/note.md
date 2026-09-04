# 笔记

## mem0

mem0/oss 依赖了 sqlite3，使用时会报 binding 错误，需要重写构建一下

```sh
npm rebuild sqlite3
```

## neo4j

```sql
-- 查询可视化
CALL db.schema.visualization();

-- 删除所有节点
MATCH (n)
DETACH DELETE n;

-- 查看 dev 数据
MATCH (n {group_id: 'dev'})
RETURN n

-- 删除 dev 数据
MATCH (n {group_id: 'dev'})
DETACH DELETE n
RETURN count(n) AS deleted_count

```

## 命令

```sh
rsync -av --delete \
  packages/source/skills/mapillary/ \
  xxx@xxx.xxx.xx.xxx:/home/yixiaojiu/.hermes/skills/mapillary/
```

## 像素游戏

| 美术规格         |      地图瓦片 | 角色可见高度 | 常见效果                           |
| ---------------- | ------------: | -----------: | ---------------------------------- |
| 低分辨率复古     |         16×16 |     16～32px | 轮廓优先，五官极简                 |
| 常规俯视像素游戏 |         32×32 |     40～64px | 能表达发型、衣服和基础表情         |
| 中高细节像素游戏 | 48×48 / 64×64 |     64～96px | 可以表现明确五官、饰品和服装层次   |
| 高细节像素动画   |    64×64 以上 |    96～128px | 接近缩小后的像素插画，制作成本较高 |
