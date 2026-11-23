from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect

from course_checks import exercise_desk, visible_motion
from course_cli import COURSE, Classroom, button, launch


def exercise(width):
    with TemporaryDirectory() as captures, launch(COURSE, {'width':width,'height':768}) as (context,url,_,_):
        teacher = context.new_page()
        teacher.goto(url + '#desk')
        frame = teacher.locator('.desk-live-frame')
        expect(frame).to_have_attribute('data-space','ready',timeout=18000)
        expect(frame.locator('video')).to_have_count(0)
        expect(frame.locator('button.scene-point')).to_have_count(2)
        room = Classroom(teacher,Path(captures),{'width':1920,'height':1080})
        student = room.project()
        canvas = frame.locator('canvas')
        before = canvas.screenshot()
        frame.press('ArrowRight')
        expect(student.locator('.desk-live-frame')).to_have_attribute('data-yaw','4.000')
        assert visible_motion(canvas.screenshot(),before)>1
        button(teacher,'翻阅左册 · 会前形势').click()
        expect(student.locator('.is-left .folio-card')).to_be_visible()
        expect(student.locator('.desk-live-frame')).to_have_attribute('data-yaw','4.000')
        button(teacher,'收起材料').click()
        button(teacher,'回到正面机位').click()
        saved = exercise_desk(teacher,student,right_first=width==1366)
        room.close_projection()
        student = room.project()
        for attribute,value in saved.items():
            expect(student.locator('.desk-live-frame')).to_have_attribute(attribute,value)
        expect(student.locator('.desk-live-transport')).not_to_be_visible()
        expect(frame.locator('video')).to_have_count(0)
        print(f'桌景通过 Edge 断网验收，教师窗口宽 {width}，直接查证和重连均通过。',flush=True)


if __name__ == '__main__':
    for teacher_width in (1366,1920):
        exercise(teacher_width)
