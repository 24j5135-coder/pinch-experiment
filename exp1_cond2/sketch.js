// ===== 実験条件(ここだけ書き換えて比較する) =====
const SOUND_PARAM    = 'sine';  // 音の種類: 'none'(音なし) | 'sine' | 'soft' | 'air' | 'organ' | 'bell'
const FREQ_MAX       = 800;      // ピッチの上限(Hz)
const SURVEY_URL     = 'https://docs.google.com/forms/d/e/1FAIpQLSc4adJLvBiYwc0KGYy0zEFshxy-kigNaSpTi3z7TYpEXPhnRw/viewform?usp=pp_url&entry.378339459=%E6%9D%A1%E4%BB%B6%EF%BC%92';       // 終了後に開くアンケートのURL(条件ごとに変える)
const PITCH_REVERSED = false;    // false: 指を広げる→低い音 / true: 指を広げる→高い音
const CIRCLE_ON      = true;     // 円: true=表示 / false=なし

// ===== 課題の設定 =====
const TRIAL_COUNT       = 10;   // ピンチ操作の回数
const STROKES_PER_COUNT = 2;    // 何ストロークで1回か(2 = 広げる+近づける)
const STROKE_MIN_PX     = 80;   // 1ストロークと数える最小の指の動き(px)。小さいほど敏感
const SHOW_PROGRESS     = true; // 上部に「3 / 10 回」を表示するか
const DEBUG             = false; // 診断用の表示(画面下)。本番では false にする

// ===== 画面に出す文章(改行は \n) =====
const TEXT_PINCH = CIRCLE_ON
  ? '円を大きくしたり\n小さくしたりするように、\n2本指で広げて近づける動きを\n指を離さず続けてください。'
  : '2本指を無理のない範囲で\n大きく広げて、近づける動きを\n指を離さず続けてください。';
const TEXT_READY = '下のボタンを押してから、\n2本指での操作を\n始めてください。';
const TEXT_DONE = '操作は以上です。\nお疲れさまでした。\n\n①下のボタンで\nデータ(CSV)を保存\n②そのあと、\nアンケートに回答';

// ===== 以下の条件は固定(必要なときだけ変更) =====
const SOUND_ON   = SOUND_PARAM !== 'none';
const SOUND_TYPE = SOUND_ON ? SOUND_PARAM : 'sine';
const FREQ_MIN   = 200;

// ===== 指の間隔 → ピッチの割り当て範囲(条件が違っても共通) =====
const D_MIN_PX    = 100;  // これ以下に指を寄せると端の音で止まる(px)
const D_MAX_RATIO = 0.8;  // 画面の対角線に対する割合。これ以上開くと反対側の端で止まる

// ===== 見た目 =====
const CIRCLE_MIN    = 20;
const CIRCLE_COLOR  = [120, 190, 255]; // 水色
const COUNT_COLOR   = [40, 120, 200];  // 回数表示の色(濃い水色)
const TEXT_COLOR    = 60;

// ===== 音の設定 =====
const REVERB_ON = true;
const LEVEL = ({ sine: 0.3, soft: 0.3, air: 0.6, organ: 0.2, bell: 0.2 }[SOUND_TYPE]) || 0.3;

// ===== 反応・記録の調整 =====
const MOVE_THRESHOLD  = 60;   // 「動いている」とみなす指の速さ(px/秒)
const SPEED_SMOOTH    = 0.6;  // 速度のなめらか化(0〜1。大きいほど速く追従)
const ATTACK_TIME     = 0.01; // 音の立ち上がり(秒)
const RELEASE_TIME    = 0.04; // 音の消え方(秒)
const HIGH_ZONE_RATIO = 0.8;  // 周波数帯の上位何割以上を「高音域」とするか

let audioCtx, gainNode;
let pitchTargets = [];
let started = false;
let circleSize, circleMax;

// 進行状況
let phase = 'ready';          // 'ready'(開始前) → 'pinch'(操作中) → 'done'(保存画面)
let trialCount = 0;           // 数え終わった回数

// 指の状態
let prevD = null, prevT = null;
let vel = 0, speed = 0, prevVel = 0, prevSpeed = 0;
let gestureId = 1, gestureStart = 0, wasTwoFingers = false;

// ストローク検出
let dir = 0;                  // 0=未確定 / 1=広げている / -1=近づけている
let anchorD = 0;              // 操作開始時の距離
let extremeD = 0;             // 現在のストロークでの最大(最小)距離
let strokesThisTrial = 0;     // 今の1回の中で数えたストローク数

// 記録
let records = [];
let t0 = null;
let exportBtn, startBtn, idInput, surveyBtn;
let participantId = '';       // 開始画面で入力された被験者ID(CSVのファイル名と各行に入る)
let idError = false;
let dbgSounding = false, dbgFreq = 0;

const CSV_HEADER = [
  'participant', 'sound', 'freq_max', 'reversed', 'circle_on',
  'gesture_id', 't_ms', 'gesture_t_ms',
  'd', 'vel', 'speed', 'acc', 'speed_acc',
  'freq', 'freq_ratio', 'high_zone', 'sounding', 'circle_size'
];

function setup() {
  createCanvas(windowWidth, windowHeight);
  circleMax = min(width, height) * 0.9;
  circleSize = min(width, height) * 0.3;

  // 開始ボタン(ここで音を許可する。iPhoneは指を離さないと音が出せないため)
  startBtn = createButton('タップして開始');
  startBtn.size(240, 64);
  startBtn.position(width / 2 - 120, height * 0.47);
  startBtn.style('font-size', '20px');
  startBtn.elt.addEventListener('click', () => {
    // 被験者ID(英数字・ハイフン・アンダースコアのみ使用)
    const id = idInput.value().trim().replace(/[^A-Za-z0-9_\-]/g, '');
    if (id === '') {
      idError = true;
      return;
    }
    participantId = id;
    idError = false;
    initAudio();
    phase = 'pinch';
    startBtn.hide();
    idInput.hide();
  });

  // 被験者ID入力欄
  idInput = createInput('');
  idInput.size(240);
  idInput.position(width / 2 - 120 - 8, height * 0.37);
  idInput.style('font-size', '20px');
  idInput.style('text-align', 'center');
  idInput.attribute('placeholder', '被験者ID(例:P01)');
  idInput.attribute('autocomplete', 'off');
  idInput.attribute('autocapitalize', 'off');

  // CSV保存ボタン(操作が終わるまで隠しておく)
  exportBtn = createButton('データ(CSV)を保存');
  exportBtn.size(220, 56);
  exportBtn.position(width / 2 - 110, height * 0.55);
  exportBtn.style('font-size', '18px');
  exportBtn.elt.addEventListener('click', exportCSV);
  exportBtn.hide();

  // アンケートへのリンクボタン(操作が終わるまで隠しておく)
  surveyBtn = createButton('アンケートに回答する');
  surveyBtn.size(220, 56);
  surveyBtn.position(width / 2 - 110, height * 0.55 + 72);
  surveyBtn.style('font-size', '18px');
  surveyBtn.elt.addEventListener('click', () => {
    if (SURVEY_URL) window.open(SURVEY_URL, '_blank');
  });
  surveyBtn.hide();
}

// ---------- 音 ----------
function makeReverbBuffer(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function initAudio() {
  if (!started) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'interactive'
    });
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 0;

    if (SOUND_TYPE === 'sine') {
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.connect(gainNode);
      osc.start();
      pitchTargets = [{ param: osc.frequency, ratio: 1 }];

    } else if (SOUND_TYPE === 'soft') {
      const lpf = audioCtx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 1800;
      lpf.Q.value = 0.5;
      lpf.connect(gainNode);

      const o1 = audioCtx.createOscillator();
      o1.type = 'triangle';
      o1.connect(lpf);
      o1.start();

      const o2 = audioCtx.createOscillator();
      o2.type = 'sine';
      const g2 = audioCtx.createGain();
      g2.gain.value = 0.5;
      o2.connect(g2);
      g2.connect(lpf);
      o2.start();

      pitchTargets = [
        { param: o1.frequency, ratio: 1 },
        { param: o2.frequency, ratio: 1.005 }
      ];

    } else if (SOUND_TYPE === 'air') {
      const bufLen = audioCtx.sampleRate * 2;
      const noiseBuf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
      const noiseData = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) noiseData[i] = Math.random() * 2 - 1;

      const src = audioCtx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;

      const bpf = audioCtx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.Q.value = 3;
      src.connect(bpf);
      bpf.connect(gainNode);
      src.start();

      pitchTargets = [{ param: bpf.frequency, ratio: 2 }];

    } else if (SOUND_TYPE === 'organ') {
      const organLpf = audioCtx.createBiquadFilter();
      organLpf.type = 'lowpass';
      organLpf.frequency.value = 2500;
      organLpf.connect(gainNode);

      const parts = [
        { ratio: 1, level: 0.6 },
        { ratio: 2, level: 0.3 },
        { ratio: 3, level: 0.15 }
      ];
      pitchTargets = [];
      for (const p of parts) {
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        const g = audioCtx.createGain();
        g.gain.value = p.level;
        osc.connect(g);
        g.connect(organLpf);
        osc.start();
        pitchTargets.push({ param: osc.frequency, ratio: p.ratio });
      }

    } else if (SOUND_TYPE === 'bell') {
      const parts = [
        { ratio: 1,    level: 0.5 },
        { ratio: 2.76, level: 0.25 },
        { ratio: 5.40, level: 0.12 }
      ];
      pitchTargets = [];
      for (const p of parts) {
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        const g = audioCtx.createGain();
        g.gain.value = p.level;
        osc.connect(g);
        g.connect(gainNode);
        osc.start();
        pitchTargets.push({ param: osc.frequency, ratio: p.ratio });
      }
    }

    gainNode.connect(audioCtx.destination);
    if (REVERB_ON) {
      const convolver = audioCtx.createConvolver();
      convolver.buffer = makeReverbBuffer(audioCtx, 1.2, 2.5);
      const wet = audioCtx.createGain();
      wet.gain.value = 0.35;
      gainNode.connect(convolver);
      convolver.connect(wet);
      wet.connect(audioCtx.destination);
    }

    started = true;
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  // iPhone対策:無音の短い音を一度鳴らして、音の再生を確実に許可させる
  const unlock = audioCtx.createBufferSource();
  unlock.buffer = audioCtx.createBuffer(1, 1, 22050);
  unlock.connect(audioCtx.destination);
  unlock.start(0);
}

function setPitch(freq) {
  for (const t of pitchTargets) {
    t.param.setTargetAtTime(freq * t.ratio, audioCtx.currentTime, 0.01);
  }
}

// ---------- 記録 ----------
function recordRow(now, d, acc, speedAcc, freq, ratio, sounding) {
  if (t0 === null) t0 = now;
  records.push([
    participantId, SOUND_PARAM, FREQ_MAX, PITCH_REVERSED ? 1 : 0, CIRCLE_ON ? 1 : 0,
    gestureId, Math.round(now - t0), Math.round(now - gestureStart),
    d.toFixed(2), vel.toFixed(2), speed.toFixed(2), acc.toFixed(1), speedAcc.toFixed(1),
    freq.toFixed(1), ratio.toFixed(3), ratio >= HIGH_ZONE_RATIO ? 1 : 0,
    sounding ? 1 : 0, circleSize.toFixed(1)
  ]);
}

function exportCSV() {
  if (records.length === 0) return;
  const lines = [CSV_HEADER.join(',')].concat(records.map(r => r.join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = 'pinch_' + participantId + '_' + SOUND_PARAM + '_max' + FREQ_MAX +
               '_' + (PITCH_REVERSED ? 'rev' : 'norm') + '_' + stamp + '.csv';
  const aTag = document.createElement('a');
  aTag.href = url;
  aTag.download = name;
  document.body.appendChild(aTag);
  aTag.click();
  document.body.removeChild(aTag);
  URL.revokeObjectURL(url);
}

function keyPressed() {
  if (key === 's' && phase === 'done') exportCSV();
}

// ---------- ストローク検出 ----------
// 指の距離 d が前の折り返し地点から STROKE_MIN_PX 以上動いたら、1ストロークと数える
function updateStrokes(d, now) {
  if (dir === 0) {
    if (abs(d - anchorD) >= STROKE_MIN_PX) {
      dir = d > anchorD ? 1 : -1;
      extremeD = d;
      strokesThisTrial++;
    }
  } else if (dir === 1) {
    if (d > extremeD) {
      extremeD = d;
    } else if (extremeD - d >= STROKE_MIN_PX) {
      dir = -1;
      extremeD = d;
      strokesThisTrial++;
    }
  } else {
    if (d < extremeD) {
      extremeD = d;
    } else if (d - extremeD >= STROKE_MIN_PX) {
      dir = 1;
      extremeD = d;
      strokesThisTrial++;
    }
  }

  // 規定のストローク数に達したら、1回として数える
  if (strokesThisTrial >= STROKES_PER_COUNT) {
    trialCount++;
    strokesThisTrial = 0;
    gestureId = trialCount + 1;
    gestureStart = now;
    if (trialCount >= TRIAL_COUNT) {
      phase = 'done';
      exportBtn.show();
      if (SURVEY_URL) surveyBtn.show();
    }
  }
}

// 2本指から指が離れたときの処理(途中だった1回分は捨てる)
function endGesture() {
  if (phase === 'pinch') {
    const id = gestureId;
    records = records.filter(r => r[5] !== id);
  }
  strokesThisTrial = 0;
  dir = 0;
}

// ---------- 描画・メイン ----------
function draw() {
  background(255);
  let targetGain = 0;
  const now = millis();
  const two = (touches.length === 2) && (phase === 'pinch');

  if (two) {
    const a = touches[0];
    const b = touches[1];
    const d = dist(a.x, a.y, b.x, b.y);

    if (!wasTwoFingers) {
      // 2本指で触れた瞬間
      gestureId = trialCount + 1;
      gestureStart = now;
      dir = 0;
      anchorD = d;
      extremeD = d;
      strokesThisTrial = 0;
    }

    let acc = 0, speedAcc = 0;

    if (prevD !== null && prevT !== null && prevD > 0) {
      const dt = (now - prevT) / 1000; // 秒
      if (dt > 0) {
        // 円：指の距離の比率で拡大縮小(実際のピンチズームと同じ)
        circleSize = constrain(circleSize * (d / prevD), CIRCLE_MIN, circleMax);

        // 速度(px/秒。正=広げる、負=狭める)
        const rawVel = (d - prevD) / dt;
        vel = lerp(vel, rawVel, SPEED_SMOOTH);
        speed = abs(vel);
        acc = (vel - prevVel) / dt;             // 加速度(符号つき)
        speedAcc = (speed - prevSpeed) / dt;    // 速さの変化(負=減速)
      }
    }
    prevVel = vel;
    prevSpeed = speed;
    prevD = d;
    prevT = now;

    // 音：円とは独立に、今の指の距離から直接ピッチを決める
    // 指の間隔 D_MIN_PX 〜 (対角線×D_MAX_RATIO) を 0〜1 に割り当てる(FREQ_MAX に依存しない)
    const maxDist = dist(0, 0, width, height) * D_MAX_RATIO;
    const t = constrain((d - D_MIN_PX) / (maxDist - D_MIN_PX), 0, 1);
    const ratio = PITCH_REVERSED ? t : 1 - t;       // 0=最低音, 1=最高音
    const freq = FREQ_MIN + ratio * (FREQ_MAX - FREQ_MIN);
    const sounding = started && SOUND_ON && speed > MOVE_THRESHOLD;

    dbgSounding = sounding; dbgFreq = freq;
    if (started && SOUND_ON) setPitch(freq);
    if (sounding) targetGain = LEVEL;

    // 先に記録してから、ストロークを判定する(数え終わった行は前の回の番号になる)
    recordRow(now, d, acc, speedAcc, freq, ratio, sounding);
    updateStrokes(d, now);
  } else {
    prevD = null;
    prevT = null;
    vel = 0;
    speed = 0;
    prevVel = 0;
    prevSpeed = 0;
    if (wasTwoFingers) endGesture();
  }
  wasTwoFingers = two;

  if (started) {
    const tc = targetGain > 0 ? ATTACK_TIME : RELEASE_TIME;
    gainNode.gain.setTargetAtTime(targetGain, audioCtx.currentTime, tc);
  }

  // ----- 画面表示 -----
  const ts = constrain(width * 0.045, 16, 26);
  noStroke();

  if (phase === 'ready') {
    textStyle(NORMAL);
    textSize(ts);
    textLeading(ts * 1.6);
    textAlign(CENTER, TOP);
    fill(TEXT_COLOR);
    text(TEXT_READY, width / 2, height * 0.2);
    if (idError) {
      fill(200, 0, 0);
      text('被験者IDを入力してください。', width / 2, height * 0.6);
    }

  } else if (phase === 'pinch') {
    // 視覚フィードバック：画面中央の水色の円(外枠なし)
    if (CIRCLE_ON) {
      fill(CIRCLE_COLOR[0], CIRCLE_COLOR[1], CIRCLE_COLOR[2]);
      ellipse(width / 2, height / 2, circleSize, circleSize);
    }

    let y = 20;

    // 回数表示(画面の一番上・大きく)
    if (SHOW_PROGRESS) {
      const cs = ts * 2.6;
      textStyle(BOLD);
      textSize(cs);
      textAlign(CENTER, TOP);
      fill(COUNT_COLOR[0], COUNT_COLOR[1], COUNT_COLOR[2]);
      text(trialCount + ' / ' + TRIAL_COUNT + ' 回', width / 2, y);
      y += cs * 1.35;
    }

    // 指示文
    textStyle(NORMAL);
    textSize(ts);
    textLeading(ts * 1.6);
    textAlign(CENTER, TOP);
    fill(TEXT_COLOR);
    text(TEXT_PINCH, width / 2, y);

  } else {
    // 操作終了：保存を促す(ボタンは setup で作成済み)
    textStyle(NORMAL);
    textSize(ts);
    textLeading(ts * 1.6);
    textAlign(CENTER, TOP);
    fill(TEXT_COLOR);
    text(TEXT_DONE, width / 2, height * 0.12);
  }

  if (DEBUG) {
    textStyle(NORMAL);
    textSize(14);
    textAlign(LEFT, TOP);
    fill(200, 0, 0);
    text('audio:' + (audioCtx ? audioCtx.state : 'none') + ' started:' + started +
         ' touches:' + touches.length + ' phase:' + phase +
         '\nspeed:' + Math.round(speed) + ' sounding:' + dbgSounding +
         ' freq:' + Math.round(dbgFreq) + ' gain:' + (gainNode ? gainNode.gain.value.toFixed(2) : '-'),
         10, height * 0.72);
  }
}

document.addEventListener('gesturestart', function (e) {
  e.preventDefault();
});
