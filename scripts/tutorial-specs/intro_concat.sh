#!/bin/zsh
# Intro = cuts of the finished feature clips: editor, booking calendar, products.
cd /tmp/tut
ffmpeg -y -v error \
 -i editing.mp4 -i calendar.mp4 -i store.mp4 -filter_complex \
 "[0:v]trim=0:1.8,setpts=PTS-STARTPTS[a];[0:v]trim=7:9.5,setpts=PTS-STARTPTS[b];\
[1:v]trim=2.5:7.5,setpts=PTS-STARTPTS[c];\
[2:v]trim=0:2,setpts=PTS-STARTPTS[d];[2:v]trim=9.5:12.5,setpts=PTS-STARTPTS[e];\
[a][b][c][d][e]concat=n=5:v=1:a=0[v]" -map "[v]" -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart -an intro.mp4
