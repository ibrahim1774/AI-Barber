import { Component, useEffect, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

// The native module may be absent (an older build, a test): then there is no video.
let VideoMod: typeof import('expo-video') | null = null;
try {
  VideoMod = require('expo-video');
} catch {
  VideoMod = null;
}

/** A hosted clip, or nothing at all when there is no uri, the player cannot start, or the clip fails to load. */
export function LearnVideo({ uri, poster }: { uri?: string; poster?: string }) {
  if (!uri || !VideoMod) return null;
  return (
    <Guard>
      <Player key={uri} uri={uri} poster={poster} />
    </Guard>
  );
}

class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Player({ uri, poster }: { uri: string; poster?: string }) {
  const { useVideoPlayer, VideoView } = VideoMod!;
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = false;
    p.muted = true; // clips are silent
    p.play();
  });
  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const subs = [
      player.addListener('playingChange', ({ isPlaying }: { isPlaying: boolean }) => {
        setPlaying(isPlaying);
        if (isPlaying) setEnded(false);
      }),
      player.addListener('playToEnd', () => {
        setEnded(true);
        setPlaying(false);
      }),
      player.addListener('statusChange', ({ status }: { status: string }) => {
        if (status === 'error') setFailed(true);
        else if (status === 'readyToPlay') setReady(true);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);
  if (failed) return null;

  // One tap: ended -> restart from 0, playing -> pause, paused -> play.
  const toggle = () => {
    if (ended) {
      setEnded(false);
      setPlaying(true);
      player.replay();
      player.play();
    } else if (playing) {
      setPlaying(false);
      player.pause();
    } else {
      setPlaying(true);
      player.play();
    }
  };

  return (
    <Pressable
      onPress={toggle}
      style={styles.box}
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Pause video' : ended ? 'Replay video' : 'Play video'}
    >
      <VideoView player={player} nativeControls={false} contentFit="contain" style={StyleSheet.absoluteFill} />
      {!ready && poster ? <Image source={{ uri: poster }} resizeMode="contain" style={StyleSheet.absoluteFill} /> : null}
      {!playing && (
        <View style={styles.playBadge}>
          <Text style={styles.playText}>{ended ? '↻ Tap to replay' : '▶ Tap to play'}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    aspectRatio: 9 / 16, maxHeight: 460, alignSelf: 'center', width: '100%', borderRadius: 14, overflow: 'hidden',
    backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.hair, alignItems: 'center', justifyContent: 'center', marginTop: 10,
  },
  playBadge: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  playText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.text },
});
