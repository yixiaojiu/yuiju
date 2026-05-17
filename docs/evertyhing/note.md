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
