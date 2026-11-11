/**
 * 一次界面打开的请求轮次。
 *
 * 每次打开或关闭都推进轮次；请求发出时记下当时的轮次，回来时轮次已变，说明对话框已经
 * 关过或重开过，这次请求的结果属于上一次，不能再写进当前界面。
 */
export class RequestEpoch {
	private current = 0;

	/** 推进轮次并返回新的值，调用方把它当作这一次的标记。 */
	advance(): number {
		this.current += 1;
		return this.current;
	}

	/** 当前轮次。 */
	get value(): number {
		return this.current;
	}

	/** 标记是否仍然属于当前轮次。 */
	matches(token: number): boolean {
		return token === this.current;
	}
}
