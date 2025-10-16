#!/usr/bin/env ruby
require 'json'
require 'fileutils'
require 'open3'
require 'timeout'

spec = JSON.parse($stdin.read)
limits = spec['limits'] || {}
Dir.chdir('/work')

ENV.clear
(spec['env'] || {}).each { |k, v| ENV[k] = v }
ENV['HOME'] = '/work'
ENV['TMPDIR'] = '/work/tmp'
ENV['PATH'] = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

FileUtils.mkdir_p('tmp')
FileUtils.mkdir_p('outputs')

HZ = 100 # Linux clock ticks per second (typical)
def read_cpu_jiffies(pid)
  begin
    stat = File.read("/proc/#{pid}/stat")
    rp = stat.rindex(')')
    return nil unless rp
    rest = stat[(rp + 2)..-1].strip.split(/\s+/)
    utime = Integer(rest[11] || '0') rescue 0
    stime = Integer(rest[12] || '0') rescue 0
    utime + stime
  rescue
    nil
  end
end

def read_vm_hwm_kb(pid)
  begin
    status = File.read("/proc/#{pid}/status")
    line = status.lines.find { |l| l.start_with?('VmHWM:') }
    return nil unless line
    Integer(line.split[1]) rescue nil
  rescue
    nil
  end
end

cmd = ['ruby', 'main.rb', '--', *(spec['args'] || [])]
stdout_str = ''
stderr_str = ''
status = nil

start_ms = (Process.clock_gettime(Process::CLOCK_MONOTONIC, :millisecond) rescue (Time.now.to_f * 1000).to_i)
cpu_jiffies = 0
max_rss_kb = 0

Open3.popen3(*cmd) do |stdin, stdout, stderr, wait_thr|
  stdin.close
  pid = wait_thr.pid

  out_thread = Thread.new { stdout_str = stdout.read.to_s }
  err_thread = Thread.new { stderr_str = stderr.read.to_s }

  timed_out = false
  timeout_thread = Thread.new do
    sleep((limits['timeout_ms'] || 5000) / 1000.0)
    begin
      Process.kill('KILL', pid)
      timed_out = true
    rescue StandardError
    end
  end

  sampler = Thread.new do
    loop do
      break unless wait_thr.alive?
      cj = read_cpu_jiffies(pid)
      cpu_jiffies = cj if cj
      rss = read_vm_hwm_kb(pid)
      max_rss_kb = [max_rss_kb, rss].compact.max if rss
      sleep 0.05
    end
  end

  status = wait_thr.value
  timeout_thread.kill
  sampler.join
  out_thread.join
  err_thread.join

  if timed_out && (stderr_str.nil? || stderr_str.empty?)
    stderr_str = 'Execution timed out'
  end

  limit = limits['max_output_bytes'] || 1024 * 1024
  $stdout.write((stdout_str || '').byteslice(0, limit) || '')
  $stderr.write((stderr_str || '').byteslice(0, limit) || '')

  wall_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC, :millisecond) rescue (Time.now.to_f * 1000).to_i) - start_ms)
  cpu_ms = ((cpu_jiffies || 0) * (1000.0 / HZ)).round
  max_rss_mb = [[max_rss_kb || 0, 0].max / 1024.0].max.round
  usage = { wall_ms: wall_ms, cpu_ms: cpu_ms, max_rss_mb: max_rss_mb }
  File.write('usage.json', JSON.generate(usage))

  exit(timed_out ? 124 : (status && status.exitstatus ? status.exitstatus : 0))
end
