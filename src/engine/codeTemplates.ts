import { Mode } from './types';

export interface CodeLine {
  num: number;
  text: string;
  comment?: string;
}

export interface AsmLine {
  num: number;
  addr: string;
  section: 'gnl_text' | 'libc_read' | 'kernel_entry';
  instruction: string;
  annotation: string;
}

export function getCSourceLines(mode: Mode): CodeLine[] {
  if (mode === 'bonus') {
    return [
      { num: 1, text: 'char *get_next_line(int fd)' },
      { num: 2, text: '{' },
      { num: 3, text: '    static char *stash[FD_MAX];', comment: '// .bss segment (zero-init)' },
      { num: 4, text: '    char        *buffer;' },
      { num: 5, text: '    ssize_t     bytes_read;' },
      { num: 6, text: '    char        *line;' },
      { num: 7, text: '' },
      { num: 8, text: '    if (fd < 0 || fd >= FD_MAX || BUFFER_SIZE <= 0)' },
      { num: 9, text: '        return (NULL);' },
      { num: 10, text: '    buffer = malloc(BUFFER_SIZE + 1);', comment: '// Heap: capacity + 1 for \\0' },
      { num: 11, text: '    if (!buffer) return (NULL);' },
      { num: 12, text: '    bytes_read = 1;' },
      { num: 13, text: '    while (!ft_strchr(stash[fd], \'\\n\') && bytes_read > 0)' },
      { num: 14, text: '    {' },
      { num: 15, text: '        bytes_read = read(fd, buffer, BUFFER_SIZE);', comment: '// libc -> syscall #0' },
      { num: 16, text: '        if (bytes_read == -1)', comment: '// kernel returned -errno' },
      { num: 17, text: '            return (free(buffer), free(stash[fd]), stash[fd] = NULL, NULL);' },
      { num: 18, text: '        buffer[bytes_read] = \'\\0\';', comment: '// manual C-string termination' },
      { num: 19, text: '        stash[fd] = ft_strjoin_free(stash[fd], buffer);' },
      { num: 20, text: '    }' },
      { num: 21, text: '    free(buffer);', comment: '// release temporary read buffer' },
      { num: 22, text: '    if (!stash[fd] || stash[fd][0] == \'\\0\')' },
      { num: 23, text: '        return (free(stash[fd]), stash[fd] = NULL, NULL);' },
      { num: 24, text: '    line = ft_extract_line(stash[fd]);', comment: '// new Heap string up to \\n' },
      { num: 25, text: '    stash[fd] = ft_trim_stash(stash[fd]);', comment: '// keep leftovers in .bss ptr' },
      { num: 26, text: '    return (line);' },
      { num: 27, text: '}' },
    ];
  }

  return [
    { num: 1, text: 'char *get_next_line(int fd)' },
    { num: 2, text: '{' },
    { num: 3, text: '    static char *stash;', comment: '// .bss segment (zero-init)' },
    { num: 4, text: '    char        *buffer;' },
    { num: 5, text: '    ssize_t     bytes_read;' },
    { num: 6, text: '    char        *line;' },
    { num: 7, text: '' },
    { num: 8, text: '    if (fd < 0 || BUFFER_SIZE <= 0)', comment: '// guard before syscall' },
    { num: 9, text: '        return (NULL);' },
    { num: 10, text: '    buffer = malloc(BUFFER_SIZE + 1);', comment: '// Heap: capacity + 1 for \\0' },
    { num: 11, text: '    if (!buffer) return (NULL);' },
    { num: 12, text: '    bytes_read = 1;' },
    { num: 13, text: '    while (!ft_strchr(stash, \'\\n\') && bytes_read > 0)' },
    { num: 14, text: '    {' },
    { num: 15, text: '        bytes_read = read(fd, buffer, BUFFER_SIZE);', comment: '// libc -> syscall #0' },
    { num: 16, text: '        if (bytes_read == -1)', comment: '// kernel returned -errno' },
    { num: 17, text: '            return (free(buffer), free(stash), stash = NULL, NULL);' },
    { num: 18, text: '        buffer[bytes_read] = \'\\0\';', comment: '// manual C-string termination' },
    { num: 19, text: '        stash = ft_strjoin_free(stash, buffer);' },
    { num: 20, text: '    }' },
    { num: 21, text: '    free(buffer);', comment: '// release temporary read buffer' },
    { num: 22, text: '    if (!stash || stash[0] == \'\\0\')' },
    { num: 23, text: '        return (free(stash), stash = NULL, NULL);' },
    { num: 24, text: '    line = ft_extract_line(stash);', comment: '// new Heap string up to \\n' },
    { num: 25, text: '    stash = ft_trim_stash(stash);', comment: '// keep leftovers in .bss ptr' },
    { num: 26, text: '    return (line);' },
    { num: 27, text: '}' },
  ];
}

export function getAsmLines(bufferSize: number): AsmLine[] {
  const bsHex = '0x' + Math.max(0, bufferSize).toString(16);
  const bsPlusOneHex = '0x' + Math.max(0, bufferSize + 1).toString(16);

  return [
    // .text get_next_line
    {
      num: 1,
      addr: '0x00401148',
      section: 'gnl_text',
      instruction: `mov    edi, ${bsPlusOneHex}`,
      annotation: `BUFFER_SIZE+1 (${bufferSize + 1}) baked as immediate in .text`,
    },
    {
      num: 2,
      addr: '0x0040114d',
      section: 'gnl_text',
      instruction: 'call   malloc@plt',
      annotation: 'returns Heap ptr in rax -> stored in stack [buffer]',
    },
    {
      num: 3,
      addr: '0x00401170',
      section: 'gnl_text',
      instruction: `mov    edx, ${bsHex}`,
      annotation: `arg3 = BUFFER_SIZE (${bufferSize}) immediate, 0 bytes RAM`,
    },
    {
      num: 4,
      addr: '0x00401175',
      section: 'gnl_text',
      instruction: 'mov    rsi, QWORD PTR [rbp-0x10]',
      annotation: 'arg2 = buffer Heap address from Stack',
    },
    {
      num: 5,
      addr: '0x00401179',
      section: 'gnl_text',
      instruction: 'mov    edi, DWORD PTR [rbp-0x14]',
      annotation: 'arg1 = fd',
    },
    {
      num: 6,
      addr: '0x0040117c',
      section: 'gnl_text',
      instruction: 'call   read@plt',
      annotation: 'enter libc read() wrapper (still Ring 3)',
    },
    // libc read() wrapper
    {
      num: 7,
      addr: '0x7ffff7ea1200',
      section: 'libc_read',
      instruction: 'mov    eax, 0x0',
      annotation: 'Linux x86-64 __NR_read syscall number = 0',
    },
    {
      num: 8,
      addr: '0x7ffff7ea1205',
      section: 'libc_read',
      instruction: 'syscall',
      annotation: 'HW TRAP: rcx<-rip, r11<-rflags, Ring 3->0, jmp LSTAR',
    },
    {
      num: 9,
      addr: '0x7ffff7ea1207',
      section: 'libc_read',
      instruction: 'cmp    rax, -0xfff',
      annotation: 'check if kernel returned -errno (-1..-4095)',
    },
    {
      num: 10,
      addr: '0x7ffff7ea120d',
      section: 'libc_read',
      instruction: 'ret',
      annotation: 'return ssize_t in rax back to get_next_line()',
    },
    // Linux Kernel Ring 0
    {
      num: 11,
      addr: '0xffffffff81c00000',
      section: 'kernel_entry',
      instruction: 'entry_SYSCALL_64:',
      annotation: 'Ring 0 entry point (MSR_LSTAR); swapgs & kernel stack',
    },
    {
      num: 12,
      addr: '0xffffffff81c00048',
      section: 'kernel_entry',
      instruction: 'call   *sys_call_table(,%rax,8)',
      annotation: 'dispatch table[0] -> __x64_sys_read(rdi, rsi, rdx)',
    },
    {
      num: 13,
      addr: '0xffffffff813a4190',
      section: 'kernel_entry',
      instruction: 'vfs_read / copy_to_user',
      annotation: 'fdget(rdi), access_ok(rsi), Page Cache -> buffer, f_pos+=n',
    },
    {
      num: 14,
      addr: '0xffffffff81c00110',
      section: 'kernel_entry',
      instruction: 'sysretq',
      annotation: 'Ring 0->3, restore rip<-rcx, rflags<-r11, rax=result',
    },
  ];
}
