#!/usr/bin/env bash
# macOS Finder에서 더블클릭하면 터미널 창이 열리며 MyStock을 실행한다.
# 실제 동작은 start.sh와 같다(이 파일은 Finder용 진입점일 뿐).
cd "$(dirname "$0")"
./start.sh
status=$?
if [ $status -ne 0 ]; then
  echo
  read -r -p "[MyStock] 오류로 종료되었습니다 (코드 $status). Enter를 누르면 창을 닫습니다." _
fi
exit $status
