#!/bin/zsh
# Intro = cuts of the finished feature clips: editor, booking calendar, products. Run after the feature clips are rendered into $D.
D=${1:-/tmp/pol/out}
cd $D
ffmpeg -y -v error \
 -i editing.mp4 -i calendar.mp4 -i store.mp4 -filter_complex \
 "[0:v]trim=0:1.9,setpts=PTS-STARTPTS[a];[0:v]trim=7.97:9.97,setpts=PTS-STARTPTS[b];\
[1:v]trim=2.5:7.5,setpts=PTS-STARTPTS[c];\
[2:v]trim=0:1.5,setpts=PTS-STARTPTS[d];[2:v]trim=11.8:14.6,setpts=PTS-STARTPTS[e];\
[a][b][c][d][e]concat=n=5:v=1:a=0[v]" -map "[v]" -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart -an intro.mp4
