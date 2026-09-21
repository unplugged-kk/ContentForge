import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SchedulePickerProps {
  dateLabel?: string;
  timeLabel?: string;
  onChange: (iso: string | null) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Real date+time input, extracted from the pattern already used in Calendar. */
export function SchedulePicker({ dateLabel = "Date", timeLabel = "Time", onChange }: SchedulePickerProps) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");

  const emit = (nextDate: string, nextTime: string) => {
    if (!nextDate) {
      onChange(null);
      return;
    }
    const local = new Date(`${nextDate}T${nextTime || "00:00"}:00`);
    onChange(Number.isNaN(local.getTime()) || local.getTime() <= Date.now() ? null : local.toISOString());
  };

  return (
    <div className="flex gap-2" data-testid="schedule-picker">
      <div className="flex-1 space-y-1">
        <Label htmlFor="schedule-picker-date" className="text-xs">{dateLabel}</Label>
        <Input
          id="schedule-picker-date"
          type="date"
          min={todayIso()}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            emit(e.target.value, time);
          }}
          data-testid="input-schedule-picker-date"
        />
      </div>
      <div className="flex-1 space-y-1">
        <Label htmlFor="schedule-picker-time" className="text-xs">{timeLabel}</Label>
        <Input
          id="schedule-picker-time"
          type="time"
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            emit(date, e.target.value);
          }}
          data-testid="input-schedule-picker-time"
        />
      </div>
    </div>
  );
}
