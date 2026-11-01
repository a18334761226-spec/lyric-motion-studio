import type { Song } from '../../shared/types';

/**
 * 内置示例曲库：全部为本次项目原创歌词（非任何已发行作品），
 * 带 LRC 时间轴，便于演示「检索 → 解析 → 分镜 → 配音 → 成片」全链路。
 */
export interface SeedSong {
  title: string;
  artist: string;
  album: string;
  language: string;
  tags: string[];
  lrc: string;
}

export const SEED_SONGS: SeedSong[] = [
  {
    title: '霓虹不眠',
    artist: 'Studio Demo',
    album: '午夜素材集',
    language: 'zh',
    tags: ['城市', '夜晚', '孤独', '抒情', '女声'],
    lrc: `[00:00.00]霓虹不眠
[00:03.50]Studio Demo
[00:08.00]
[00:12.00]雨在玻璃上写没说完的话
[00:17.50]路灯把影子拉成一把吉他
[00:23.00]凌晨两点的街道没有人回答
[00:28.50]我把心事调成最轻的音量
[00:34.00]霓虹不眠 我也没睡
[00:39.50]数着车流 像数着后悔
[00:45.00]城市的光 落在肩上很累
[00:50.50]却照不亮 你离开的那条街
[00:56.00]电梯停在二十三层
[01:01.50]我听见风在楼道里转身
[01:07.00]把白天折叠 塞进口袋
[01:12.50]假装明天 还会有期待
[01:18.00]霓虹不眠 我也没睡
[01:23.50]数着车流 像数着后悔
[01:29.00]城市的光 落在肩上很累
[01:34.50]却照不亮 你离开的那条街
[01:40.00]如果沉默也有颜色
[01:45.50]大概是这凌晨的蓝
[01:51.00]我把最后一个字咽下
[01:56.50]等天亮 等一句晚安`,
  },
  {
    title: '把夏天寄给你',
    artist: 'Studio Demo',
    album: '青春期样本',
    language: 'zh',
    tags: ['青春', '清新', '校园', '治愈', '女声'],
    lrc: `[00:00.00]把夏天寄给你
[00:03.50]Studio Demo
[00:08.00]
[00:11.00]梧桐叶把阳光剪成碎片
[00:16.00]蝉鸣在耳机里绕了三圈
[00:21.00]你骑着单车冲下长坡
[00:26.00]白衬衫鼓成一整片天
[00:31.00]我把夏天装进信封
[00:36.00]贴上云朵当作邮票
[00:41.00]在毕业照的背面
[00:46.00]写下没说出口的心跳
[00:51.00]风一吹 就跑向你
[00:56.00]风一停 就想起你
[01:01.00]操场的白线画不出结局
[01:06.00]我们却跑过了整个青春期
[01:11.00]把夏天寄给你
[01:16.00]连同汽水的气泡和勇气
[01:21.00]如果某天你收到
[01:26.00]请记得 那年我有多喜欢你`,
  },
  {
    title: '旧胶片',
    artist: 'Studio Demo',
    album: '午后素材集',
    language: 'zh',
    tags: ['怀旧', '胶片', '温柔', '男声', '叙事'],
    lrc: `[00:00.00]旧胶片
[00:03.50]Studio Demo
[00:08.00]
[00:12.00]老式挂钟走得比心事慢
[00:17.50]阳台的茉莉开了一半
[00:23.00]你把信写在日历背面
[00:28.50]说秋天适合把话说完
[00:34.00]旧胶片转啊转
[00:39.50]转出那年夏天的光斑
[00:45.00]你的笑停在第三格
[00:50.50]再也没能继续播放
[00:56.00]我学会了把想念
[01:01.50]晾在阳光里晒干
[01:07.00]像你教我叠的纸船
[01:12.50]放进水里就不回头看
[01:18.00]旧胶片转啊转
[01:23.50]转出模糊的站台和伞
[01:29.00]那些说不出口的遗憾
[01:34.50]后来都成了风轻云淡`,
  },
  {
    title: '一叶舟',
    artist: 'Studio Demo',
    album: '水墨集',
    language: 'zh',
    tags: ['国风', '水墨', '离愁', '诗意', '男声'],
    lrc: `[00:00.00]一叶舟
[00:03.50]Studio Demo
[00:08.00]
[00:12.00]山色入墨 云落入江
[00:17.50]一叶舟 载不动离殇
[00:23.00]你折的柳 还挂在岸上
[00:28.50]风一过 就摇成了过往
[00:34.00]我借月色 写你模样
[00:39.50]写到一半 纸已泛黄
[00:45.00]谁在桥头 弹断弦上
[00:50.50]一声轻叹 落满回廊
[00:56.00]春秋几轮 雪落几场
[01:01.50]山水依旧 人各一方
[01:07.00]我把思念 折成船桨
[01:12.50]划过岁月 划不过你心上`,
  },
  {
    title: '凌晨四点的雨',
    artist: 'Studio Demo',
    album: '失眠实录',
    language: 'zh',
    tags: ['失眠', '雨夜', '克制', '独白', '女声'],
    lrc: `[00:00.00]凌晨四点的雨
[00:03.50]Studio Demo
[00:08.00]
[00:11.50]四点零七分 雨还没停
[00:17.00]天花板在听我数呼吸
[00:22.50]手机屏幕亮了又暗
[00:28.00]没有一条消息是你
[00:33.50]我把窗帘拉开一条缝
[00:39.00]让风替我做个决定
[00:44.50]该放下 还是再等一等
[00:50.00]答案在雨里 说不清
[00:55.50]凌晨四点的雨 下得很安静
[01:01.00]像谁把心事 轻轻放平
[01:06.50]我不再问 也不再证明
[01:12.00]天亮以后 我就走开 就当路过你`,
  },
  {
    title: '逆光飞行',
    artist: 'Studio Demo',
    album: '重启计划',
    language: 'zh',
    tags: ['励志', '热血', '赛博', '奔跑', '男声'],
    lrc: `[00:00.00]逆光飞行
[00:03.50]Studio Demo
[00:07.50]
[00:11.00]鞋底磨平 也想跑得更远
[00:16.00]城市的边缘 亮起新的航线
[00:21.00]他们说黑夜太长 不适合做梦
[00:26.00]我偏要点亮 整条街的灯
[00:31.00]逆着光 我也要飞行
[00:36.00]把每一次跌倒 都算作前进
[00:41.00]心跳在耳边 敲成鼓点
[00:46.00]所有不被看好 都变成燃料的点
[00:51.00]风越大 越要睁大眼睛
[00:56.00]那些说不可能的声音 我当背景
[01:01.00]逆着光 也能看清自己
[01:06.00]飞过之后 世界为我让出一片天`,
  },
  {
    title: 'Paper Planes',
    artist: 'Studio Demo',
    album: 'English Samples',
    language: 'en',
    tags: ['english', 'chill', 'city', 'night'],
    lrc: `[00:00.00]Paper Planes
[00:03.00]Studio Demo
[00:07.00]
[00:10.50]Folded the map into a paper plane
[00:15.50]Threw it out the window in the rain
[00:20.50]Every street light hums a lower key
[00:25.50]The city keeps a secret just for me
[00:30.50]I'm not lost, I'm just unhurried
[00:35.50]Carrying a quiet I have buried
[00:40.50]Paper planes above the avenue
[00:45.50]Somewhere in the dark they'll find you too
[00:50.50]Let the night go by, let the neon glow
[00:55.50]I'll be walking home the long way, slow`,
  },
  {
    title: '山海未见',
    artist: 'Studio Demo',
    album: '远行集',
    language: 'zh',
    tags: ['远方', '山海', '辽阔', '国风', '大合唱'],
    lrc: `[00:00.00]山海未见
[00:03.50]Studio Demo
[00:08.00]
[00:12.00]我翻过山 山后还是山
[00:17.50]我听人说 海在更远的地方
[00:23.00]行囊里装着 母亲缝的月光
[00:28.50]走一步 就把故乡忘一点
[00:34.00]山海未见 少年已远
[00:39.50]风吹过旷野 吹不散信念
[00:45.00]若有一天 我站在海边
[00:50.50]会替所有出发的人 说一声值得
[00:56.00]星子落在 荒原的肩
[01:01.50]我把名字 写进风里面
[01:07.00]山海未见 路在眼前
[01:12.50]这一程 我走得心甘情愿`,
  },
];

/** 把 seed 转换成 Song 记录（id 固定，便于重复启动幂等） */
export function seedSongs(now: number): Song[] {
  return SEED_SONGS.map((s, i) => {
    const lines = parseLrcForSeed(s.lrc);
    return {
      id: `seed-${String(i + 1).padStart(2, '0')}`,
      title: s.title,
      artist: s.artist,
      album: s.album,
      language: s.language,
      tags: s.tags,
      lrc: s.lrc,
      source: 'local' as const,
      sourceLabel: '内置原创示例',
      durationSec: lines.length ? Math.round(lines[lines.length - 1].start + 6) : undefined,
      lineCount: lines.length,
      excerpt: lines.slice(0, 2).map((l) => l.text).join(' / '),
      createdAt: now,
    };
  });
}

function parseLrcForSeed(lrc: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const m = raw.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (!m) continue;
    const text = (m[4] || '').trim();
    if (!text) continue;
    const ms = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
    out.push({ start: Number(m[1]) * 60 + Number(m[2]) + ms, text });
  }
  return out;
}
